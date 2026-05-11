const DATA_URL = "final_climate_data.csv";
const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const width = 960;
const height = 500;

let climateData = [];
let dataByYear = new Map();
let selectedYear = 1850;

const yearSlider = d3.select("#year-slider");
const yearLabel = d3.select("#year-label");
const tooltip = d3.select("#tooltip");

const projection = d3
  .geoEquirectangular()
  .scale(150)
  .translate([width / 2, height / 2]);

const path = d3.geoPath(projection);

const colorScale = d3
  .scaleThreshold()
  .domain([-4, -2, 0, 1, 2, 4, 6])
  .range([
    "#08519c", // less than -4°C
    "#6baed6", // -4°C to -2°C
    "#ffffff", // -2°C to 0°C
    "#ffd6d6", // 0°C to 1°C
    "#ff9b9b", // 1°C to 2°C
    "#ff4d4d", // 2°C to 4°C
    "#d40000", // 4°C to 6°C
    "#7a0000"  // 6°C and above
  ]);

const container = d3.select("#map-container");

const canvas = container
  .append("canvas")
  .attr("id", "heat-canvas")
  .attr("width", width)
  .attr("height", height);

const ctx = canvas.node().getContext("2d");

const svg = container
  .append("svg")
  .attr("id", "map-svg")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

const mapLayer = svg.append("g");
const hoverLayer = svg.append("g");

loadData();

async function loadData() {
  const [world, rawData] = await Promise.all([
    d3.json(WORLD_URL),
    d3.csv(DATA_URL, d => ({
      year: +d.year,
      lat: +d.lat,
      lon: normalizeLon(+d.lon),
      region: d.region,
      temp_change: +d.temp_change
    }))
  ]);

  climateData = rawData;

  d3.select(".loading").remove();

  drawBaseMap(world);
  prepareData();
  drawMap(selectedYear);

  yearSlider.on("input", event => {
    selectedYear = +event.target.value;
    yearLabel.text(selectedYear);
    drawMap(selectedYear);
  });
}

function normalizeLon(lon) {
  return lon > 180 ? lon - 360 : lon;
}

function drawBaseMap(world) {
  const countries = topojson.feature(world, world.objects.countries).features;

  const borders = topojson.mesh(
    world,
    world.objects.countries,
    (a, b) => a !== b
  );

  mapLayer
    .selectAll("path")
    .data(countries)
    .join("path")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "rgba(40, 40, 40, 0.35)")
    .attr("stroke-width", 0.35);

  mapLayer
    .append("path")
    .datum(borders)
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "rgba(40, 40, 40, 0.35)")
    .attr("stroke-width", 0.35);
}

function prepareData() {
  dataByYear = d3.group(climateData, d => d.year);
}

function drawMap(year) {
  const yearData = dataByYear.get(year) || [];

  ctx.clearRect(0, 0, width, height);

  ctx.globalAlpha = 0.18;

  yearData.forEach(d => {
    const point = projection([d.lon, d.lat]);

    if (!point) return;

    const [x, y] = point;
    const binColor = colorScale(d.temp_change);

    const gradient = ctx.createRadialGradient(
      x,
      y,
      0,
      x,
      y,
      6
    );

    gradient.addColorStop(0, binColor);
    gradient.addColorStop(0.4, binColor);
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = gradient;

    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.globalAlpha = 1;

  refreshStats(yearData);
  drawHoverLayer(yearData);
}

function drawHoverLayer(yearData) {
  hoverLayer.selectAll("*").remove();

  hoverLayer
    .selectAll(".hover-point")
    .data(yearData, d => `${d.lat}-${d.lon}`)
    .join("circle")
    .attr("class", "hover-point")
    .attr("cx", d => projection([d.lon, d.lat])?.[0] ?? -999)
    .attr("cy", d => projection([d.lon, d.lat])?.[1] ?? -999)
    .attr("r", 4)
    .attr("fill", "transparent")
    .attr("pointer-events", "all")
    .on("mousemove", (event, d) => {
      tooltip
        .classed("visible", true)
        .style("left", `${event.clientX + 14}px`)
        .style("top", `${event.clientY - 24}px`)
        .html(`
          <div><strong>Location:</strong> ${d.region}</div>
          <div><strong>Year:</strong> ${d.year}</div>
          <div><strong>Temperature bin:</strong> ${getBinLabel(d.temp_change)}</div>
          <div><strong>Exact value:</strong> ${formatTemp(d.temp_change)}</div>
        `);
    })
    .on("mouseleave", () => {
      tooltip.classed("visible", false);
    });
}

function getBinLabel(value) {
  if (value < -4) return "Below -4°C";
  if (value < -2) return "-4°C to -2°C";
  if (value < 0) return "-2°C to 0°C";
  if (value < 1) return "0°C to 1°C";
  if (value < 2) return "1°C to 2°C";
  if (value < 4) return "2°C to 4°C";
  if (value < 6) return "4°C to 6°C";
  return "6°C and above";
}

function formatTemp(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}°C`;
}

const playBtn = d3.select("#play-btn");
let isPlaying = false;
let playTimer = null;

playBtn.on("click", () => {
  if (isPlaying) {
    clearInterval(playTimer);
    isPlaying = false;
    playBtn.text("▶ Play");
    return;
  }

  isPlaying = true;
  playBtn.text("Ⅱ Pause");

  playTimer = setInterval(() => {
    selectedYear += 5;

    if (selectedYear > 2100) {
      selectedYear = 1850;
    }

    yearSlider.property("value", selectedYear);
    yearLabel.text(selectedYear);
    drawMap(selectedYear);
  }, 250);
});

function refreshStats(yearData) {
  if (!yearData.length) return;

  const temps = yearData.map(d => d.temp_change);

  const mean = d3.mean(temps);
  const max = d3.max(temps);
  const min = d3.min(temps);

  const above2 = Math.round(
    yearData.filter(d => d.temp_change > 2).length / yearData.length * 100
  );

  d3.select("#stat-mean").text(formatTemp(mean));
  d3.select("#stat-max").text(formatTemp(max));
  d3.select("#stat-min").text(formatTemp(min));
  d3.select("#stat-above2").text(`${above2}%`);
}
