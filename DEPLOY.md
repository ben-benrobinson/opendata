# Deploy: App + Cache

## Prerequisites

- AWS account
- AWS CLI installed and configured (`aws configure`)
- (Optional) Git repo pushed to GitHub/GitLab/Bitbucket for Amplify

---

## Step 1: Deploy the app and get a public URL

You can use **Amplify** (easiest, good if your code is in Git) or **S3 + CloudFront** (no Git required).

### Option A: AWS Amplify (recommended)

1. **Push your code to GitHub** (or GitLab/Bitbucket) if you haven’t already.

2. **Create an Amplify app**
   - In the AWS Console go to **Amplify** → **New app** → **Host web app**.
   - Connect your Git provider and select the repo and branch.
   - Amplify will detect the app (or you can point it at the repo root).

3. **Use the repo’s build spec**
   - The repo includes `amplify.yml`. Amplify will use it automatically.
   - Build settings:
     - **Build command:** `npm run build`
     - **Output directory:** `dist`
   - If Amplify didn’t pick `amplify.yml`, add those in the Amplify Console under **Build settings**.

4. **Deploy**
   - Save and deploy. When the build finishes you’ll get a URL like:
     - `https://main.xxxx.amplifyapp.com`
   - That’s your public app URL (no custom domain needed).

5. **Optional: use the cache later**  
   After Step 2, in Amplify go to **Environment variables** and add:
   - `VITE_CACHE_BASE_URL` = `https://your-cache-cloudfront-domain.cloudfront.net`
   - Redeploy so the app uses the cached datasets.

---

### Option B: S3 + CloudFront (no Git)

1. **Build locally**
   ```bash
   npm ci
   npm run build
   ```
   Output is in `dist/`.

2. **Create an S3 bucket for the site**
   ```bash
   BUCKET=opendata-app-yourname   # must be globally unique
   aws s3 mb s3://$BUCKET --region us-east-1
   ```

3. **Upload the build**
   ```bash
   aws s3 sync dist/ s3://$BUCKET --delete
   ```

4. **Enable static website hosting**
   ```bash
   aws s3 website s3://$BUCKET --index-document index.html --error-document index.html
   ```
   (Use `index.html` for both so client-side routing works.)

5. **Create a CloudFront distribution**
   - In the AWS Console: **CloudFront** → **Create distribution**.
   - **Origin domain:** choose the S3 bucket (e.g. `opendata-app-yourname.s3.amazonaws.com`).
   - **Origin path:** leave blank.
   - **Default root object:** `index.html`.
   - **Error pages:** Add custom error response for 403 and 404 with response 200 and response page path `index.html` (for SPA routing).
   - Create the distribution. When it’s deployed, your public URL is:
     - `https://dxxxx.cloudfront.net`

6. **Optional: use the cache**  
   After Step 2, rebuild the app with the cache URL and re-sync:
   ```bash
   VITE_CACHE_BASE_URL=https://your-cache-cloudfront.net npm run build
   aws s3 sync dist/ s3://$BUCKET --delete
   aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
   ```

---

## Step 2: Add the cache (S3 + Lambda + EventBridge)

This pulls Open Data once per day, stores JSON in S3, and (optionally) serves it via CloudFront so the app can load data quickly.

### 2.1 Create the cache S3 bucket

```bash
CACHE_BUCKET=opendata-cache-yourname   # globally unique
aws s3 mb s3://$CACHE_BUCKET --region us-east-1
```

### 2.2 Make cached files readable by the browser (public read)

- **Option 1 – Bucket policy (simple for a small project)**  
  In S3 → bucket → **Permissions** → **Bucket policy**, use a policy that allows public read on the cache prefix, e.g.:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadDatasets",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::opendata-cache-yourname/datasets/*"
    }
  ]
}
```

Replace `opendata-cache-yourname` with your `CACHE_BUCKET`.  
Then turn off “Block all public access” for the bucket (S3 will warn; confirm if you’re okay with public read on `datasets/*` only).

**CORS:** So the browser (your app on Amplify or CloudFront) can fetch cached JSON, add CORS on the cache bucket. S3 → bucket → **Permissions** → **CORS** — use a rule with `AllowedOrigins` including your app URL or `["*"]`, and `AllowedMethods`: `["GET", "HEAD"]`.

- **Option 2 – CloudFront only (no public S3)**  
  Keep the bucket private. Create a second CloudFront distribution with the cache bucket as origin and use **Origin Access Control**. Then the app uses the CloudFront URL as `VITE_CACHE_BASE_URL` and never hits S3 directly.

### 2.3 Create the Lambda function

1. **Zip the Lambda code**
   ```bash
   cd lambda/cache-datasets
   zip -j function.zip index.js
   ```

2. **Create the function in AWS**
   ```bash
   aws lambda create-function \
     --function-name opendata-cache-datasets \
     --runtime nodejs18.x \
     --handler index.handler \
     --zip-file fileb://function.zip \
     --role arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_LAMBDA_EXECUTION_ROLE \
     --timeout 300 \
     --environment "Variables={CACHE_BUCKET=$CACHE_BUCKET}"
   ```

   You need an IAM role that allows:
   - `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`
   - `s3:PutObject`, `s3:PutObjectAcl` on `arn:aws:s3:::CACHE_BUCKET/datasets/*`

   **Quick role via Console:**
   - **Lambda** → **Create function** → **Author from scratch**.
   - Name: `opendata-cache-datasets`, Runtime: **Node.js 18**.
   - Under **Permissions** create a new role with basic Lambda execution (CloudWatch Logs).
   - After creation, go to **Configuration** → **Permissions** → role name. In IAM, attach an inline policy:
     - Effect: Allow  
     - Actions: `s3:PutObject`, `s3:PutObjectAcl`  
     - Resource: `arn:aws:s3:::opendata-cache-yourname/datasets/*`
   - Upload the zip: **Code** → **Upload from** → **.zip file** → `function.zip`.
   - **Configuration** → **Environment variables** → Add `CACHE_BUCKET` = `opendata-cache-yourname`.
   - **Configuration** → **General** → Timeout: **5 min**.

### 2.4 Run the Lambda once to fill the cache

In the Lambda console, **Test** (create a test event, e.g. `{}`) and run it. Check the cache bucket: you should see `datasets/*.json` objects.

### 2.5 Schedule daily runs (EventBridge)

1. In the AWS Console go to **EventBridge** → **Rules** → **Create rule**.
2. **Name:** `opendata-cache-daily`.
3. **Schedule:** Recurring, e.g. `cron(0 12 * * ? *)` (noon UTC daily) or `rate(1 day)`.
4. **Target:** Lambda function → `opendata-cache-datasets`.
5. Create the rule.

Or with CLI (replace `YOUR_ACCOUNT_ID` and `YOUR_REGION`):

```bash
aws events put-rule \
  --name opendata-cache-daily \
  --schedule-expression "cron(0 12 * * ? *)" \
  --state ENABLED

aws events put-targets \
  --rule opendata-cache-daily \
  --targets "Id"="1","Arn"="arn:aws:lambda:YOUR_REGION:YOUR_ACCOUNT_ID:function:opendata-cache-datasets"

aws lambda add-permission \
  --function-name opendata-cache-datasets \
  --statement-id EventBridgeInvoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:YOUR_REGION:YOUR_ACCOUNT_ID:rule/opendata-cache-daily
```

### 2.6 Point the app at the cache

- **If the bucket is public:**  
  Dataset URLs are:  
  `https://opendata-cache-yourname.s3.amazonaws.com/datasets/311-service-requests.json`  
  (and similarly for other slugs). So:
  - `VITE_CACHE_BASE_URL=https://opendata-cache-yourname.s3.amazonaws.com/datasets`  
  But the app expects a base URL that you append `/{slug}.json` to, so actually:
  - `VITE_CACHE_BASE_URL=https://opendata-cache-yourname.s3.amazonaws.com/datasets`  
  and the app will request `.../datasets/311-service-requests.json` → no, the app does `${base}/${slug}.json`, so base should be `https://.../datasets` and then `${base}/311-service-requests.json` = `https://.../datasets/311-service-requests.json`. Good.

- **If you use CloudFront in front of the cache bucket:**  
  Use the CloudFront domain as base, e.g.  
  `VITE_CACHE_BASE_URL=https://dxxxx.cloudfront.net/datasets`  
  (again so that `base + "/" + slug + ".json"` is the object URL).

Set `VITE_CACHE_BASE_URL` in Amplify env vars (and redeploy) or in your build command for the S3/CloudFront option, then the app will load from the cache instead of Open Data.

---

## Summary

| Step | What you get |
|------|----------------|
| 1A – Amplify | App at `https://main.xxxx.amplifyapp.com` |
| 1B – S3 + CF | App at `https://dxxxx.cloudfront.net` |
| 2 | Cache bucket with `datasets/*.json`, Lambda filling it daily, optional CloudFront for cache |
| 2.6 | Set `VITE_CACHE_BASE_URL` and redeploy app → app uses cached data |

No domain name is required; you can add a custom domain later in Amplify or CloudFront if you want.
