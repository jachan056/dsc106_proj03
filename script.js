const DATA_URL = "final_climate_data.csv";
const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const width = 960;
const height = 500;

let climateData = [];
let dataByYear = new Map();
let selectedYear = 1850;
let selectedTemp = 0;
let summaryMode = true;
const tempTolerance = 0.25;
const tempExtent = [-4, 5];
let currentZoomTransform = d3.zoomIdentity;
let mapZoomLevel = 1;
let countryFeatures = [];
let isPanningMap = false;
let panStart = null;
let panMoved = false;
let suppressNextMapClick = false;
let activePanel = "left";

const panelColors = {
  left: "#08519c",
  right: "#c4622d"
};

const panelSelections = {
  left: null,
  right: null
};

const yearSlider = d3.select("#year-slider");
const yearLabel = d3.select("#year-label");
const yearFilterLabel = d3.select("#year-filter-label");
const tempSlider = d3.select("#temp-slider");
const tempFilterLabel = d3.select("#temp-filter-label");
const viewModeLabel = d3.select("#view-mode-label");
const summaryBtn = d3.select("#summary-btn");
const tooltip = d3.select("#tooltip");

const projection = d3
  .geoEquirectangular()
  .scale(150)
  .translate([width / 2, height / 2]);

const path = d3.geoPath(projection);

// Continuous temperature color scale. Values at or below -4°C clamp to blue, 0°C is white, and values at or above +5°C clamp to red.
const colorScale = d3
  .scaleLinear()
  .domain([-4, 0, 5])
  .range(["#2166ac", "#ffffff", "#b2182b"])
  .clamp(true);

const container = d3.select("#map-container");

const mapContent = container
  .append("div")
  .attr("id", "map-zoom-content");

const canvas = mapContent
  .append("canvas")
  .attr("id", "heat-canvas")
  .attr("width", width)
  .attr("height", height);

const ctx = canvas.node().getContext("2d");

const svg = mapContent
  .append("svg")
  .attr("id", "map-svg")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

const mapLayer = svg.append("g");
const selectedLayer = svg.append("g");
const hoverLayer = svg.append("g");

setupMapZoom();

function setupMapZoom() {
  addZoomButtons();
  addMapPanHandlers();
  applyMapZoom();
}

function addZoomButtons() {
  const controls = d3.select("#zoom-controls-row");
  if (controls.empty() || !controls.select("button").empty()) return;

  controls
    .on("click", event => event.stopPropagation())
    .on("pointerdown", event => event.stopPropagation())
    .on("pointermove", event => event.stopPropagation())
    .on("pointerup", event => event.stopPropagation());

  controls
    .append("button")
    .attr("type", "button")
    .attr("aria-label", "Zoom in")
    .text("+")
    .on("click", event => {
      event.stopPropagation();
      zoomByButton(1.35);
    });

  controls
    .append("button")
    .attr("type", "button")
    .attr("aria-label", "Zoom out")
    .text("−")
    .on("click", event => {
      event.stopPropagation();
      zoomByButton(1 / 1.35);
    });

  controls
    .append("button")
    .attr("type", "button")
    .attr("aria-label", "Reset zoom")
    .attr("class", "reset-zoom-btn")
    .text("Reset")
    .on("click", event => {
      event.stopPropagation();
      resetMapZoom();
    });
}

function zoomByButton(factor) {
  const oldK = mapZoomLevel;
  const newK = Math.max(1, Math.min(6, oldK * factor));

  if (newK === oldK) return;

  const box = container.node().getBoundingClientRect();
  const centerX = box.width / 2;
  const centerY = box.height / 2;

  const oldX = currentZoomTransform.x;
  const oldY = currentZoomTransform.y;

  const newX = centerX - (centerX - oldX) * (newK / oldK);
  const newY = centerY - (centerY - oldY) * (newK / oldK);

  mapZoomLevel = newK;
  currentZoomTransform = clampMapTransform(d3.zoomIdentity.translate(newX, newY).scale(newK));
  applyMapZoom();
}

function resetMapZoom() {
  mapZoomLevel = 1;
  currentZoomTransform = d3.zoomIdentity;
  applyMapZoom();
}

function addMapPanHandlers() {
  const node = container.node();

  node.addEventListener("pointerdown", event => {
    if (event.target.closest(".map-zoom-controls")) return;

    panMoved = false;

    const clickedPoint = event.target.classList.contains("hover-point")
      ? event.target.__data__
      : null;

    panStart = {
      x: event.clientX,
      y: event.clientY,
      tx: currentZoomTransform.x,
      ty: currentZoomTransform.y,
      clickedPoint
    };

    if (mapZoomLevel > 1) {
      isPanningMap = true;
      suppressNextMapClick = false;
      node.setPointerCapture(event.pointerId);
      node.classList.add("is-panning");
    }
  });

  node.addEventListener("pointermove", event => {
    if (!panStart) return;

    const dx = event.clientX - panStart.x;
    const dy = event.clientY - panStart.y;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      panMoved = true;
    }

    if (!isPanningMap || mapZoomLevel <= 1) return;

    currentZoomTransform = clampMapTransform(
      d3.zoomIdentity
        .translate(panStart.tx + dx, panStart.ty + dy)
        .scale(mapZoomLevel)
    );

    applyMapZoom();
  });

  function endPan(event) {
    if (!panStart) return;

    event.stopPropagation();

    const clickedPoint = panStart.clickedPoint;
    const wasClick = !panMoved;

    if (isPanningMap) {
      node.classList.remove("is-panning");

      try {
        node.releasePointerCapture(event.pointerId);
      } catch (e) {
        // Ignore release errors.
      }
    }

    isPanningMap = false;
    panStart = null;

    if (wasClick && clickedPoint) {
      selectMapPoint(clickedPoint, activePanel);
      activePanel = activePanel === "left" ? "right" : "left";
    }

    panMoved = false;
    suppressNextMapClick = false;
  }

  node.addEventListener("pointerup", endPan);
  node.addEventListener("pointercancel", endPan);
}

function clampMapTransform(transform) {
  if (transform.k <= 1) return d3.zoomIdentity;

  const box = container.node().getBoundingClientRect();
  const minX = box.width * (1 - transform.k);
  const minY = box.height * (1 - transform.k);

  const clampedX = Math.min(0, Math.max(minX, transform.x));
  const clampedY = Math.min(0, Math.max(minY, transform.y));

  return d3.zoomIdentity.translate(clampedX, clampedY).scale(transform.k);
}

function applyMapZoom() {
  currentZoomTransform = clampMapTransform(currentZoomTransform);
  mapZoomLevel = currentZoomTransform.k;

  const t = currentZoomTransform;
  mapContent.style("transform", `translate(${t.x}px, ${t.y}px) scale(${t.k})`);
  container.classed("map-is-zoomed", t.k > 1);
}

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
  setupTemperatureSlider();
  drawMap(selectedYear);
  applyMapZoom();

  yearSlider.on("input", event => {
    selectedYear = +event.target.value;
    yearLabel.text(selectedYear);
    yearFilterLabel.text(selectedYear);
    drawMap(selectedYear);
    updateCurrentYearDots();
  });

  tempSlider.on("input", event => {
    event.stopPropagation();
    selectedTemp = +event.target.value;
    summaryMode = false;
    updateTemperatureLabel();
    updateViewModeText();
    drawMap(selectedYear);
  });

  summaryBtn.on("click", event => {
    event.stopPropagation();
    summaryMode = true;
    updateViewModeText();
    drawMap(selectedYear);
  });

  setupResetClick();
}

function normalizeLon(lon) {
  return lon > 180 ? lon - 360 : lon;
}

function drawBaseMap(world) {
  const countries = topojson.feature(world, world.objects.countries).features;
  countryFeatures = countries;

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

function setupTemperatureSlider() {
  const [minTemp, maxTemp] = tempExtent;
  selectedTemp = 0;

  tempSlider
    .attr("min", minTemp)
    .attr("max", maxTemp)
    .attr("step", tempTolerance)
    .property("value", selectedTemp);

  d3.select("#temp-min-label").text(`≤ ${formatTemp(minTemp)}`);
  d3.select("#temp-max-label").text(`≥ ${formatTemp(maxTemp)}`);
  d3.select("#legend-min-label").text(`≤ ${formatTemp(minTemp)}`);
  d3.select("#legend-max-label").text(`≥ ${formatTemp(maxTemp)}`);

  updateTemperatureLabel();
  updateViewModeText();
}

function updateTemperatureLabel() {
  tempFilterLabel.text(`${formatTemp(selectedTemp)} ± ${tempTolerance.toFixed(2)}°C`);
}

function updateViewModeText() {
  if (summaryMode) {
    viewModeLabel.text("Summary view: all points shown");
    summaryBtn.classed("active", true);
  } else {
    viewModeLabel.text(`Filtered view is active`);
    summaryBtn.classed("active", false);
  }
}

function filterBySelectedTemperature(yearData) {
  return yearData.filter(d => Math.abs(d.temp_change - selectedTemp) <= tempTolerance);
}

function drawMap(year) {
  const yearData = dataByYear.get(year) || [];
  const visibleData = summaryMode ? yearData : filterBySelectedTemperature(yearData);

  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = 0.34;

  visibleData.forEach(d => {
    const point = projection([d.lon, d.lat]);
    if (!point) return;

    const [x, y] = point;
    const tempColor = colorScale(d.temp_change);

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, 7);
    gradient.addColorStop(0, tempColor);
    gradient.addColorStop(0.4, tempColor);
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.globalAlpha = 1;

  refreshStats(yearData);
  // Keep the click/hover layer based on the full year data, not only the filtered visible data.
  // This lets the side chart work for every map point even when that point is hidden by the temperature filter.
  drawHoverLayer(yearData);
  drawSelectedMapMarkers();
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
          <div><strong>Region:</strong> ${d.region}</div>
          <div><strong>Country:</strong> ${getCountryName(d.lat, d.lon)}</div>
          <div><strong>Year:</strong> ${d.year}</div>
          <div><strong>Temperature:</strong> ${formatTemp(d.temp_change)}</div>
        `);
    })
    .on("mouseleave", () => {
      tooltip.classed("visible", false);
    });
}

function selectMapPoint(d, panelSide) {
  const selection = {
    lat: d.lat,
    lon: d.lon,
    region: d.region,
    country: getCountryName(d.lat, d.lon),
    clickedPoint: null
  };

  panelSelections[panelSide] = selection;

  d3.select(`#${panelSide}-title`).html(`
    <div>${d.region}</div>
    <div style="font-size:0.8rem; font-weight:400; color:#777; margin-top:2px;">
      ${selection.country}
    </div>
  `);
  showTimeSeries(selection, panelSide);
  showSelectedRegionText(panelSide);
  drawSelectedMapMarkers();
  updateCurrentYearDots();
}

function drawSelectedMapMarkers() {
  const markers = Object.entries(panelSelections)
    .filter(([, selection]) => selection)
    .map(([panelSide, selection]) => ({ panelSide, ...selection }));

  selectedLayer.selectAll("*").remove();

  const groups = selectedLayer
    .selectAll(".selected-map-marker")
    .data(markers, d => d.panelSide)
    .join("g")
    .attr("class", "selected-map-marker")
    .attr("transform", d => {
      const point = projection([d.lon, d.lat]) || [-999, -999];
      return `translate(${point[0]},${point[1]})`;
    });

  groups
    .append("circle")
    .attr("r", 8)
    .attr("fill", "none")
    .attr("stroke", d => panelColors[d.panelSide])
    .attr("stroke-width", 3);

  groups
    .append("circle")
    .attr("r", 3.5)
    .attr("fill", d => panelColors[d.panelSide])
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.2);
}

function formatTemp(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}°C`;
}

const playBtn = d3.select("#play-btn");
let isPlaying = false;
let playTimer = null;

playBtn.on("click", event => {
  event.stopPropagation();

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
    yearFilterLabel.text(selectedYear);
    drawMap(selectedYear);
    updateCurrentYearDots();
  }, 1000);
});

function refreshStats(yearData) {
  if (!yearData.length) {
    d3.select("#stat-mean").text("—");
    d3.select("#stat-max").text("—");
    d3.select("#stat-min").text("—");
    return;
  }

  const temps = yearData.map(d => d.temp_change);

  const mean = d3.mean(temps);
  const max = d3.max(temps);
  const min = d3.min(temps);


  d3.select("#stat-mean").text(formatTemp(mean));
  d3.select("#stat-max").text(formatTemp(max));
  d3.select("#stat-min").text(formatTemp(min));
}

function showTimeSeries(selection, panelSide) {
  const locationHistory = climateData
    .filter(d => d.lat === selection.lat && d.lon === selection.lon)
    .sort((a, b) => a.year - b.year);

  if (locationHistory.length === 0) return;

  const chartContainer = d3.select(`#${panelSide}-chart-container`);
  chartContainer.selectAll("*").remove();

  const panelWidth = chartContainer.node().getBoundingClientRect().width || 280;
  const margin = { top: 18, right: 18, bottom: 62, left: 46 };
  const chartWidth = panelWidth - margin.left - margin.right;
  const chartHeight = 250 - margin.top - margin.bottom;

  const svg = chartContainer
    .append("svg")
    .attr("class", "side-chart")
    .attr("width", chartWidth + margin.left + margin.right)
    .attr("height", chartHeight + margin.top + margin.bottom);

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear()
    .domain(d3.extent(locationHistory, d => d.year))
    .range([0, chartWidth]);

  const y = d3.scaleLinear()
    .domain([-5, 10])
    .nice()
    .range([chartHeight, 0]);

  g.append("g")
    .attr("transform", `translate(0,${chartHeight})`)
    .call(d3.axisBottom(x).tickValues([1850, 1900, 1950, 2000, 2050, 2100]).tickFormat(d3.format("d")))
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .style("text-anchor", "end");

  g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d}°C`));

  g.append("line")
    .attr("x1", 0)
    .attr("x2", chartWidth)
    .attr("y1", y(0))
    .attr("y2", y(0))
    .attr("stroke", "#999")
    .attr("stroke-dasharray", "4,4");

  g.append("text")
  .attr("transform", "rotate(-90)")
  .attr("x", -chartHeight / 2)
  .attr("y", -36)
  .attr("text-anchor", "middle")
  .attr("fill", "#666")
  .style("font-size", "12px")
  .text("Temperature Change (°C)");

  g.append("text")
  .attr("x", chartWidth / 2)
  .attr("y", chartHeight + 50)
  .attr("text-anchor", "middle")
  .attr("fill", "#666")
  .style("font-size", "12px")
  .text("Year");    

  const line = d3.line()
    .x(d => x(d.year))
    .y(d => y(d.temp_change));

  g.append("path")
    .datum(locationHistory)
    .attr("fill", "none")
    .attr("stroke", panelColors[panelSide])
    .attr("stroke-width", 2.5)
    .attr("d", line);

  g.selectAll(".dot")
    .data(locationHistory)
    .enter()
    .append("circle")
    .attr("class", d => `dot side-dot ${d.year === selectedYear ? "current-year-dot" : ""}`)
    .attr("data-year", d => d.year)
    .attr("cx", d => x(d.year))
    .attr("cy", d => y(d.temp_change))
    .attr("r", d => d.year === selectedYear ? 6 : 4)
    .attr("fill", "#ffffff")
    .attr("stroke", d => d.year === selectedYear ? "#111111" : panelColors[panelSide])
    .attr("stroke-width", d => d.year === selectedYear ? 2.5 : 1.8)
    .style("cursor", "pointer")
    .on("click", (event, pointData) => {
      event.stopPropagation();
      panelSelections[panelSide].clickedPoint = pointData;
      showPointDetails(pointData, panelSide);
      updateClickedPointHighlight(panelSide);
    });
}

function showSelectedRegionText(panelSide) {
  const selection = panelSelections[panelSide];
  const details = d3.select(`#${panelSide}-details`);

  details.classed("hidden", false);
  d3.select(`#${panelSide}-coords`).text(formatCoords(selection.lat, selection.lon));
  d3.select(`#${panelSide}-year`).text("Click a chart point");
  d3.select(`#${panelSide}-val`).text("—").attr("class", "");
}

function showPointDetails(d, panelSide) {
  const selection = panelSelections[panelSide];
  d3.select(`#${panelSide}-details`).classed("hidden", false);
  d3.select(`#${panelSide}-coords`).text(formatCoords(selection.lat, selection.lon));
  d3.select(`#${panelSide}-year`).text(d.year);
  d3.select(`#${panelSide}-val`).text(formatTemp(d.temp_change)).attr("class", "");
}

function updateCurrentYearDots() {
  ["left", "right"].forEach(panelSide => {
    if (!panelSelections[panelSide]) return;

    const chart = d3.select(`#${panelSide}-chart-container`);

    chart.selectAll(".side-dot")
      .classed("current-year-dot", d => d.year === selectedYear)
      .attr("r", d => {
        const clicked = panelSelections[panelSide].clickedPoint;
        if (clicked && clicked.year === d.year) return 7;
        return d.year === selectedYear ? 6 : 4;
      })
      .attr("stroke", d => {
        const clicked = panelSelections[panelSide].clickedPoint;
        if (clicked && clicked.year === d.year) return panelColors[panelSide];
        return d.year === selectedYear ? "#111111" : panelColors[panelSide];
      })
      .attr("stroke-width", d => {
        const clicked = panelSelections[panelSide].clickedPoint;
        if (clicked && clicked.year === d.year) return 3;
        return d.year === selectedYear ? 2.5 : 1.8;
      });
  });
}

function updateClickedPointHighlight(panelSide) {
  updateCurrentYearDots();

  const clicked = panelSelections[panelSide]?.clickedPoint;
  if (!clicked) return;

  d3.select(`#${panelSide}-chart-container`)
    .selectAll(".side-dot")
    .classed("clicked-point", d => d.year === clicked.year);
}

function getCountryName(lat, lon) {
  if (!countryFeatures.length) return "Ocean / unavailable";

  const point = [lon, lat];
  const country = countryFeatures.find(feature => d3.geoContains(feature, point));

  if (!country) return "Ocean / unavailable";

  return country.properties?.name || country.properties?.NAME || "Country unavailable";
}

function formatCoords(lat, lon) {
  const latStr = Math.abs(lat).toFixed(1) + "°" + (lat >= 0 ? "N" : "S");
  const lonStr = Math.abs(lon).toFixed(1) + "°" + (lon >= 0 ? "E" : "W");
  return `${latStr}, ${lonStr}`;
}

function setupResetClick() {
  d3.select("#map-container").on("click", event => event.stopPropagation());
  d3.selectAll(".side-panel").on("click", event => event.stopPropagation());

  d3.select(document.body).on("click", () => {
    resetSelections();
  });
}

function resetSelections() {
  panelSelections.left = null;
  panelSelections.right = null;
  activePanel = "left";
  selectedLayer.selectAll("*").remove();
  tooltip.classed("visible", false);

  ["left", "right"].forEach(panelSide => {
    d3.select(`#${panelSide}-title`).text(panelSide === "left" ? "Location 1" : "Location 2");
    d3.select(`#${panelSide}-chart-container`)
      .html(`<p class="placeholder">Click the map to select the ${panelSide === "left" ? "first" : "second"} location.</p>`);
    d3.select(`#${panelSide}-details`).classed("hidden", true);
  });
}
