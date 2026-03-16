import React, { useState } from "react";
import * as Papa from "papaparse";
// You can use a library like recharts for simple visualizations:
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer
} from 'recharts';

// A representative static list of NYC OpenData datasets
// Use the Socrata-style JSON APIs with row limits rather than
// downloading full CSV exports, which can be huge and slow.
// Slug is used for cached dataset URLs (e.g. when VITE_CACHE_BASE_URL is set).
const NYC_DATASETS = [
  { name: "311 Service Requests", slug: "311-service-requests", url: "https://data.cityofnewyork.us/resource/erm2-nwe9.json" },
  { name: "NYC Subway Entrances", slug: "nyc-subway-entrances", url: "https://data.ny.gov/resource/i9wp-a4ja.json" },
  { name: "Film Permits", slug: "film-permits", url: "https://data.cityofnewyork.us/resource/tg4x-b46p.json" },
  { name: "NYC Jobs", slug: "nyc-jobs", url: "https://data.cityofnewyork.us/resource/kpav-sd4t.json" },
  { name: "NYC Motor Vehicle Collisions", slug: "nyc-motor-vehicle-collisions", url: "https://data.cityofnewyork.us/resource/h9gi-nx95.json" },
  { name: "Street Tree Census", slug: "street-tree-census", url: "https://data.cityofnewyork.us/resource/uvpi-gqnh.json" },
  { name: "Covid-19 Data", slug: "covid-19-data", url: "https://data.cityofnewyork.us/resource/rc75-m7u3.json" },
  { name: "Restaurant Inspection Results", slug: "restaurant-inspection-results", url: "https://data.cityofnewyork.us/resource/43nn-pn8j.json" },
];

const CACHE_BASE_URL = import.meta.env.VITE_CACHE_BASE_URL || "";

function getDatasetUrl(dataset) {
  if (CACHE_BASE_URL && dataset.slug) {
    const base = CACHE_BASE_URL.replace(/\/$/, "");
    return `${base}/${dataset.slug}.json`;
  }
  return dataset.url;
}

// Utility functions from before:
function getExtension(url) {
  // Strip off query string and hash so URLs like
  // "...rows.csv?accessType=DOWNLOAD" are treated as CSV.
  const cleanUrl = url.split(/[?#]/)[0];
  const lastDot = cleanUrl.lastIndexOf(".");
  if (lastDot === -1) return "";
  return cleanUrl.slice(lastDot + 1).toLowerCase();
}

function guessNumericFields(data) {
  if (data.length === 0) return [];
  const header = Object.keys(data[0]);
  return header.filter(key => {
    for (let i = 0; i < Math.min(data.length, 10); i++) {
      if (data[i][key] === undefined) continue;
      if (!isNaN(Number(data[i][key])) && data[i][key] !== "") return true;
    }
    return false;
  });
}

function guessCategories(data) {
  if (data.length === 0) return [];
  const headers = Object.keys(data[0]);
  // prefer fields with string data and fewer unique values
  return headers.filter(key => {
    const values = data.map(item => item[key]);
    const unique = new Set(values);
    return unique.size < data.length / 2 && unique.size > 1;
  });
}

const AGGREGATIONS = [
  { value: "none", label: "None (raw)", needsY: true, yMustBeNumeric: true },
  { value: "count", label: "Count", needsY: false, yMustBeNumeric: false },
  { value: "countUnique", label: "Count unique", needsY: true, yMustBeNumeric: false },
  { value: "sum", label: "Sum", needsY: true, yMustBeNumeric: true },
  { value: "mean", label: "Mean", needsY: true, yMustBeNumeric: true },
];

function aggregateData(data, xField, yField, aggregation) {
  if (aggregation === "none" || !data.length) return null;
  const groups = new Map();
  for (const row of data) {
    const xVal = row[xField];
    if (xVal === undefined || xVal === null || xVal === "") continue;
    const key = String(xVal).trim();
    if (!groups.has(key)) {
      if (aggregation === "count") groups.set(key, 0);
      else if (aggregation === "countUnique") groups.set(key, new Set());
      else groups.set(key, []);
    }
    const g = groups.get(key);
    if (aggregation === "count") groups.set(key, g + 1);
    else if (aggregation === "countUnique") {
      const yVal = row[yField];
      if (yVal !== undefined && yVal !== null && yVal !== "") g.add(String(yVal));
      groups.set(key, g);
    } else {
      const yVal = row[yField];
      const num = Number(yVal);
      if (yVal !== undefined && yVal !== null && yVal !== "" && !isNaN(num)) g.push(num);
      groups.set(key, g);
    }
  }
  return Array.from(groups.entries())
    .map(([name, val]) => {
      let value;
      if (aggregation === "count") value = val;
      else if (aggregation === "countUnique") value = val.size;
      else if (aggregation === "sum") value = val.reduce((a, b) => a + b, 0);
      else if (aggregation === "mean") value = val.length ? val.reduce((a, b) => a + b, 0) / val.length : 0;
      else value = 0;
      return { name: name.length > 30 ? name.slice(0, 27) + "…" : name, value, fullName: name };
    })
    .filter(d => d.value !== undefined && (aggregation === "count" || d.value > 0))
    .sort((a, b) => b.value - a.value);
}

export default function NYCOpenDataViz() {
  const [datasetUrl, setDatasetUrl] = useState("");
  const [selectedDataset, setSelectedDataset] = useState(""); // Track dataset selection
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState([]);
  const [fields, setFields] = useState([]);
  const [numericFields, setNumericFields] = useState([]);
  const [categoryFields, setCategoryFields] = useState([]);
  const [xField, setXField] = useState("");
  const [yField, setYField] = useState("");
  const [error, setError] = useState("");
  const [chartType, setChartType] = useState("Bar");
  const [aggregation, setAggregation] = useState("count");

  // When the dropdown changes, update the dataset URL too
  const handleSelectChange = (e) => {
    const dataset = NYC_DATASETS.find(d => d.name === e.target.value);
    setSelectedDataset(e.target.value);
    setDatasetUrl(dataset ? getDatasetUrl(dataset) : "");
  };

  const fetchDataset = async () => {
    setLoading(true);
    setError("");
    setRawData([]);
    setFields([]);
    setNumericFields([]);
    setCategoryFields([]);
    setXField("");
    setYField("");

    let controller;
    let timeoutId;

    try {
      // Add an explicit timeout so we never appear to
      // "hang forever" if an endpoint is slow or down.
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        // Allow a bit more time but still fail fast enough
        // that the UI never feels "stuck forever".
        timeoutId = setTimeout(() => controller.abort(), 30000);
      }

      const fetchOptions = controller ? { signal: controller.signal } : {};
      const response = await fetch(datasetUrl, fetchOptions);
      if (!response.ok) {
        throw new Error(`Network response was not ok (status ${response.status})`);
      }
      const filetype = getExtension(datasetUrl);
      let data = [];
      if (filetype === "csv") {
        const text = await response.text();
        const parsed = Papa.parse(text, {header:true, skipEmptyLines:true});
        if (parsed.error || parsed.errors?.length) {
          throw new Error("Could not parse CSV: " + (parsed.errors?.[0]?.message || 'Unknown error'));
        }
        data = parsed.data;
      } else if (filetype === "json") {
        data = await response.json();
      } else {
        throw new Error("Only CSV or JSON files are supported");
      }
      if (!Array.isArray(data) || !data.length) throw new Error("No data found in file");
      setRawData(data);
      setFields(Object.keys(data[0]));
      const nums = guessNumericFields(data);
      setNumericFields(nums);
      setYField(nums[0] || "");
      const cats = guessCategories(data);
      setCategoryFields(cats);
      setXField(cats[0] || "");
    } catch(e) {
      if (e.name === "AbortError") {
        setError("Request timed out. This dataset may be too large or temporarily unavailable. Try again or choose another dataset.");
      } else {
        setError(e.message || String(e));
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      setLoading(false);
    }
  };

  const renderChart = () => {
    const computeAnomalyFlags = (data, valueKey) => {
      if (!data || !data.length || !valueKey) return data || [];
      const numericValues = data
        .map(d => Number(d[valueKey]))
        .filter(v => !isNaN(v));
      if (numericValues.length < 5) return data;
      const mean =
        numericValues.reduce((sum, v) => sum + v, 0) / numericValues.length;
      const variance =
        numericValues.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) /
        numericValues.length;
      const stdDev = Math.sqrt(variance);
      if (!stdDev || !isFinite(stdDev)) return data;
      const threshold = 2.5;
      return data.map(point => {
        const rawVal = Number(point[valueKey]);
        if (isNaN(rawVal)) return { ...point, isAnomaly: false };
        const z = (rawVal - mean) / stdDev;
        return { ...point, isAnomaly: Math.abs(z) >= threshold };
      });
    };

    const renderAnomalyDot = (props) => {
      const { cx, cy, payload } = props;
      if (cx == null || cy == null) return null;
      const baseRadius = 3;
      const anomalyRadius = 7;
      return (
        <g>
          <circle cx={cx} cy={cy} r={baseRadius} fill="#82ca9d" stroke="none" />
          {payload?.isAnomaly && (
            <circle
              cx={cx}
              cy={cy}
              r={anomalyRadius}
              fill="none"
              stroke="#ff4b5c"
              strokeWidth={2}
            />
          )}
        </g>
      );
    };

    if (!xField) return <div>Please select a field for the X-axis (group by).</div>;

    const aggConfig = AGGREGATIONS.find(a => a.value === aggregation);
    const useAggregated = aggregation !== "none";
    if (useAggregated) {
      if (aggConfig?.needsY && !yField) return <div>Please select a Y field for this aggregation.</div>;
      const aggregatedRaw = aggregateData(rawData, xField, yField || xField, aggregation);
      const aggregated = computeAnomalyFlags(aggregatedRaw, "value");
      if (!aggregated?.length) {
        return (
          <div>
            No aggregated data for this combination. Try a different X field or aggregation.
          </div>
        );
      }
      const valueKey = "value";
      const labelKey = "name";

      if (chartType === "Pie") {
        const COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff7c7c", "#8dd1e1", "#a4de6c", "#d0ed57", "#83a6ed"];
        return (
          <ResponsiveContainer width="100%" height={400}>
            <PieChart margin={{ top: 16, right: 24, left: 24, bottom: 16 }}>
              <Pie
                data={aggregated}
                dataKey={valueKey}
                nameKey={labelKey}
                cx="50%"
                cy="50%"
                outerRadius={140}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                labelLine
              >
                {aggregated.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(val, name, props) => [val, props.payload?.fullName ?? name]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );
      }
      if (chartType === "Bar") {
        return (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart
              data={aggregated}
              margin={{ top: 16, right: 24, left: 8, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey={labelKey}
                tick={{ fontSize: 11, fill: "#e5e7eb" }}
                angle={-35}
                textAnchor="end"
                height={70}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#e5e7eb" }}
                width={70}
                label={{ value: aggConfig?.label || "Value", angle: -90, position: "insideLeft", style: { fill: "#e5e7eb" } }}
              />
              <Tooltip />
              <Legend />
              <Bar dataKey={valueKey} name={aggConfig?.label || "Value"} fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        );
      }
      if (chartType === "Line") {
        return (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart
              data={aggregated}
              margin={{ top: 16, right: 24, left: 8, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey={labelKey}
                tick={{ fontSize: 11, fill: "#e5e7eb" }}
                angle={-35}
                textAnchor="end"
                height={70}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#e5e7eb" }}
                width={70}
                label={{ value: aggConfig?.label || "Value", angle: -90, position: "insideLeft", style: { fill: "#e5e7eb" } }}
              />
              <Tooltip />
              <Legend />
              <Line
                dataKey={valueKey}
                name={aggConfig?.label || "Value"}
                stroke="#82ca9d"
                dot={renderAnomalyDot}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        );
      }
      return null;
    }

    // Raw mode: require numeric Y
    if (!yField) return <div>Please select X and Y axes for raw data.</div>;
    const chartDataRaw = rawData
      .slice(0, 500)
      .filter(row => {
        const xVal = row[xField];
        const yVal = row[yField];
        if (xVal === undefined || xVal === null || xVal === "") return false;
        if (yVal === undefined || yVal === null || yVal === "") return false;
        return !isNaN(Number(yVal));
      });

    const chartData = computeAnomalyFlags(chartDataRaw, yField);

    if (!chartData.length) {
      return (
        <div>
          No clean numeric data for this X/Y combination. Try aggregation (e.g. Count) for categorical data, or pick a numeric Y field.
        </div>
      );
    }

    if (chartType === "Bar") {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={chartData}
            margin={{ top: 16, right: 24, left: 8, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey={xField}
              tick={{ fontSize: 11, fill: "#e5e7eb" }}
              angle={-35}
              textAnchor="end"
              height={70}
            />
            <YAxis tick={{ fontSize: 11, fill: "#e5e7eb" }} width={70} />
            <Tooltip />
            <Legend />
            <Bar dataKey={yField} fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === "Line") {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart
            data={chartData}
            margin={{ top: 16, right: 24, left: 8, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey={xField}
              tick={{ fontSize: 11, fill: "#e5e7eb" }}
              angle={-35}
              textAnchor="end"
              height={70}
            />
            <YAxis tick={{ fontSize: 11, fill: "#e5e7eb" }} width={70} />
            <Tooltip />
            <Legend />
            <Line
              dataKey={yField}
              stroke="#82ca9d"
              dot={renderAnomalyDot}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === "Pie") {
      return (
        <div>
          For raw data, use an aggregation (e.g. Count or Count unique) to see a pie chart.
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{maxWidth:800, margin:"40px auto", fontFamily:"sans-serif"}}>
      <h2>NYC Open Data Visualizer</h2>
      <p>
        Choose a dataset below to load and visualize.
      </p>
      <div style={{display:"flex", gap:8, marginBottom:16, alignItems:'center'}}>
        <label htmlFor="dataset-dropdown"><b>Dataset:</b></label>
        <select
          id="dataset-dropdown"
          value={selectedDataset}
          onChange={handleSelectChange}
          style={{padding:6, minWidth:230}}
        >
          <option value="">-- Select a dataset --</option>
          {NYC_DATASETS.map(d =>
            <option key={d.name} value={d.name}>{d.name}</option>
          )}
        </select>
        <button onClick={fetchDataset} disabled={loading || !selectedDataset}>
          {loading ? "Loading..." : "Load Data"}
        </button>
      </div>
      {error && <div style={{color:'red', marginBottom:12}}>{error}</div>}
      {fields.length > 0 &&
        <div style={{margin:"16px 0", padding:12, border:"1px solid #ccc"}}>
          <div style={{display:"flex", flexWrap:"wrap", gap:16, alignItems:"center", marginBottom:8}}>
            <label>
              Chart type:&nbsp;
              <select value={chartType} onChange={e=>setChartType(e.target.value)}>
                <option value="Bar">Bar</option>
                <option value="Line">Line</option>
                <option value="Pie">Pie</option>
              </select>
            </label>
            <label>
              Aggregation:&nbsp;
              <select
                value={aggregation}
                onChange={e=>{
                  setAggregation(e.target.value);
                  if (e.target.value === "none" && !numericFields.includes(yField)) setYField(numericFields[0] || "");
                  if (e.target.value === "count") setYField("");
                }}
              >
                {AGGREGATIONS.map(a => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </label>
            <label>
              Group by (X):&nbsp;
              <select value={xField} onChange={e=>setXField(e.target.value)}>
                {
                  categoryFields.concat(fields.filter(f => !categoryFields.includes(f))).map(f =>
                    <option key={f} value={f}>{f}</option>
                  )
                }
              </select>
            </label>
            { (aggregation === "none" || aggregation === "countUnique" || aggregation === "sum" || aggregation === "mean") &&
              <label>
                Y (value):&nbsp;
                <select value={yField} onChange={e=>setYField(e.target.value)}>
                  { aggregation === "none" &&
                    numericFields.concat(fields.filter(f => !numericFields.includes(f))).map(f =>
                      <option key={f} value={f}>{f}</option>
                    ) }
                  { (aggregation === "countUnique" || aggregation === "sum" || aggregation === "mean") &&
                    (aggregation === "sum" || aggregation === "mean"
                      ? numericFields.concat(fields.filter(f => !numericFields.includes(f)))
                      : fields
                    ).map(f => <option key={f} value={f}>{f}</option>)
                  }
                  { aggregation !== "count" && <option value="">—</option> }
                </select>
              </label>
            }
            { aggregation === "count" &&
              <span style={{color:"#888", fontSize:14}}>Y optional (counting rows per group)</span>
            }
          </div>
          {renderChart()}
        </div>
      }
      {rawData.length > 0 &&
        <details style={{marginTop:16}}>
          <summary>Preview Raw Data (first 5 rows)</summary>
          <table style={{width:"100%", fontSize:13, borderCollapse:"collapse", marginTop: 8}}>
            <thead>
              <tr>
                {fields.map(f=><th key={f} style={{borderBottom:"1px solid #ddd", textAlign:'left', padding:"2px 4px"}}>{f}</th>)}
              </tr>
            </thead>
            <tbody>
              {rawData.slice(0,5).map((row,i)=>
                <tr key={i}>
                  {fields.map(f=>
                    <td key={f} style={{borderBottom:"1px solid #eee", padding:"2px 4px"}}>
                      {
                        // Some APIs return nested objects (e.g. { type, coordinates })
                        // which React can't render directly as children. For preview
                        // purposes, stringify any non-primitive values.
                        row[f] !== null && typeof row[f] === "object"
                          ? JSON.stringify(row[f])
                          : row[f]
                      }
                    </td>
                  )}
                </tr>
              )}
            </tbody>
          </table>
        </details>
      }
    </div>
  );
}
