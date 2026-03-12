import React, { useState } from "react";
import * as Papa from "papaparse";
// You can use a library like recharts for simple visualizations:
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer
} from 'recharts';

// A representative static list of NYC OpenData datasets
const NYC_DATASETS = [
  {
    name: "311 Service Requests",
    url: "https://data.cityofnewyork.us/api/views/erm2-nwe9/rows.csv?accessType=DOWNLOAD"
  },
  {
    name: "NYC Subway Entrances",
    url: "https://data.cityofnewyork.us/api/views/he7q-3hwy/rows.csv?accessType=DOWNLOAD"
  },
  {
    name: "Film Permits",
    url: "https://data.cityofnewyork.us/api/views/tg4x-b46p/rows.csv?accessType=DOWNLOAD"
  },
  {
    name: "NYC Jobs",
    url: "https://data.cityofnewyork.us/api/views/kpav-sd4t/rows.csv?accessType=DOWNLOAD"
  },
  {
    name: "NYC Motor Vehicle Collisions",
    url: "https://data.cityofnewyork.us/api/views/h9gi-nx95/rows.csv?accessType=DOWNLOAD"
  },
  {
    name: "Street Tree Census",
    url: "https://data.cityofnewyork.us/api/views/uvpi-gqnh/rows.csv?accessType=DOWNLOAD"
  },
  {
    name: "Covid-19 Data",
    url: "https://data.cityofnewyork.us/api/views/rc75-m7u3/rows.csv?accessType=DOWNLOAD"
  },
  {
    name: "Restaurant Inspection Results",
    url: "https://data.cityofnewyork.us/api/views/43nn-pn8j/rows.csv?accessType=DOWNLOAD"
  },
];

// Utility functions from before:
function getExtension(url) {
  return url.slice(((url.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
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

    try {
      // Assume CSV files only for simplicity.
      const response = await fetch(datasetUrl);
      if (!response.ok) throw new Error("Network response was not ok");
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
      setError(e.message || String(e));
    } finally {
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
                      {row[f]}
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
