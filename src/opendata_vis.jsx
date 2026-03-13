import React, { useState } from "react";
import * as Papa from "papaparse";
// You can use a library like recharts for simple visualizations:
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer
} from 'recharts';

// A representative static list of NYC OpenData datasets
// Use the Socrata-style JSON APIs with row limits rather than
// downloading full CSV exports, which can be huge and slow.
const NYC_DATASETS = [
  {
    name: "311 Service Requests",
    // 311 has a lot of rows; fetch a small sample
    // so it loads quickly without timing out.
    url: "https://data.cityofnewyork.us/resource/erm2-nwe9.json?$limit=500"
  },
  {
    name: "NYC Subway Entrances",
    // Original NYC Open Data view is now 404; use the
    // State of New York Open Data API instead.
    url: "https://data.ny.gov/resource/i9wp-a4ja.json?$limit=500"
  },
  {
    name: "Film Permits",
    url: "https://data.cityofnewyork.us/resource/tg4x-b46p.json?$limit=500"
  },
  {
    name: "NYC Jobs",
    url: "https://data.cityofnewyork.us/resource/kpav-sd4t.json?$limit=500"
  },
  {
    name: "NYC Motor Vehicle Collisions",
    // This dataset is extremely large; keep the limit
    // quite low so the UI stays responsive.
    url: "https://data.cityofnewyork.us/resource/h9gi-nx95.json?$limit=500"
  },
  {
    name: "Street Tree Census",
    url: "https://data.cityofnewyork.us/resource/uvpi-gqnh.json?$limit=500"
  },
  {
    name: "Covid-19 Data",
    url: "https://data.cityofnewyork.us/resource/rc75-m7u3.json?$limit=500"
  },
  {
    name: "Restaurant Inspection Results",
    url: "https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit=500"
  },
];

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

  // When the dropdown changes, update the dataset URL too
  const handleSelectChange = (e) => {
    const url = NYC_DATASETS.find(d => d.name === e.target.value)?.url || "";
    setSelectedDataset(e.target.value);
    setDatasetUrl(url);
  };

  const handleUrlChange = (e) => {
    setDatasetUrl(e.target.value);
    setSelectedDataset("");
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
    if (!yField || !xField) return <div>Please select X and Y axes.</div>;

    if (chartType === "Bar") {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={rawData.slice(0,100)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xField} tick={{fontSize: 12}} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey={yField} fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    else if (chartType === "Line") {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={rawData.slice(0,100)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xField} tick={{fontSize: 12}} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line dataKey={yField} stroke="#82ca9d" />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    // You could add Pie, Scatter, etc.
    return null;
  };

  return (
    <div style={{maxWidth:800, margin:"40px auto", fontFamily:"sans-serif"}}>
      <h2>NYC Open Data Visualizer</h2>
      <p>
        Choose a dataset below or paste in any CSV or JSON file URL from <a href="https://opendata.cityofnewyork.us" target="_blank" rel="noopener noreferrer">opendata.cityofnewyork.us</a>.<br />
        (Right-click "Export" &gt; "CSV (utf-8)" or "JSON" to get the direct link.)
      </p>
      <div style={{display:"flex", gap:8, marginBottom:10, alignItems:'center'}}>
        <label htmlFor="dataset-dropdown"><b>NYC Data Sources:</b></label>
        <select
          id="dataset-dropdown"
          value={selectedDataset}
          onChange={handleSelectChange}
          style={{padding:6, minWidth:230}}
        >
          <option value="">-- Select a NYC Dataset --</option>
          {NYC_DATASETS.map(d =>
            <option key={d.name} value={d.name}>{d.name}</option>
          )}
        </select>
      </div>
      <div style={{display:"flex", gap:8, marginBottom:16}}>
        <input
          type="text"
          value={datasetUrl}
          onChange={handleUrlChange}
          placeholder="Enter CSV or JSON URL"
          style={{flex:1, padding:8}}
        />
        <button onClick={fetchDataset} disabled={loading || !datasetUrl}>
          {loading ? "Loading..." : "Load Data"}
        </button>
      </div>
      {error && <div style={{color:'red', marginBottom:12}}>{error}</div>}
      {fields.length > 0 &&
        <div style={{margin:"16px 0", padding:12, border:"1px solid #ccc"}}>
          <div style={{display:"flex", gap:16, alignItems:'center', marginBottom:8}}>
            <label>
              Chart Type:&nbsp;
              <select value={chartType} onChange={e=>setChartType(e.target.value)}>
                <option>Bar</option>
                <option>Line</option>
              </select>
            </label>
            <label>
              X-Axis:&nbsp;
              <select value={xField} onChange={e=>setXField(e.target.value)}>
                {
                  categoryFields.concat(fields.filter(f => !categoryFields.includes(f))).map(f =>
                    <option key={f} value={f}>{f}</option>
                  )
                }
              </select>
            </label>
            <label>
              Y-Axis:&nbsp;
              <select value={yField} onChange={e=>setYField(e.target.value)}>
                {
                  numericFields.concat(fields.filter(f => !numericFields.includes(f))).map(f =>
                    <option key={f} value={f}>{f}</option>
                  )
                }
              </select>
            </label>
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
