// ================= NUSAGIS - APPLICATION CONTROLLER =================

// Global App State
// Global App State
const state = {
  currentUser: null,
  activeLayer: 'survey_points', // 'survey_points', 'digitized_lines', 'digitized_polygons'
  gnssAccuracy: 'Single',       // 'Single', 'DGPS', 'Float', 'Fix'
  gnssCoords: { lat: -6.2088, lng: 106.8456, elevation: 28.5 }, // Default Jakarta
  rulerActive: false,
  rulerPoints: [],
  rulerLines: [],
  rulerMarkers: [],
  
  // Datastores (saved in localStorage / MySQL)
  database: {
    survey_points: [],
    digitized_lines: [],
    digitized_polygons: [],
    imported_layers: {}
  },
  
  // Cached lists from MySQL DB
  users: [],
  licenses: [],
  leads: [],
  logs: []
};

// Leaflet Map Handles
let mainMap = null;
let radarMap = null;
let sqlPreviewMap = null;

// Leaflet Layer Groups (Main Map)
const mapLayers = {
  survey_points: null,
  digitized_lines: null,
  digitized_polygons: null,
  imported: null, // LayerGroup for imported custom shapes
  ruler: null,    // Ruler lines drawing layer
  sql_visualizer: null // Layer group for rendering SQL outputs
};

// Basemaps dictionary
let baseLayers = {};

// Radar map surveyor markers
let radarMarkers = {};
let surveyorSimulationInterval = null;

// ================= INITIALIZATION & SETUP =================

document.addEventListener('DOMContentLoaded', () => {
  // Load database cache from localStorage if exists
  const storedDB = localStorage.getItem('nusagis_db');
  if (storedDB) {
    try {
      state.database = JSON.parse(storedDB);
    } catch (e) {
      console.error('Error loading DB from localStorage, resetting.', e);
    }
  }

  // Check login session
  const activeSession = localStorage.getItem('nusagis_session');
  if (activeSession) {
    try {
      const user = JSON.parse(activeSession);
      state.currentUser = user;
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('main-workspace').classList.remove('hidden');
      initAppLayout();
    } catch (e) {
      localStorage.removeItem('nusagis_session');
    }
  }

  // Start simulated GPS RTK connection quality search
  startGNSSAccuracySimulation();
});

// Dropdown handler helper
function toggleDropdown(id) {
  const dropdown = document.getElementById(id);
  dropdown.classList.toggle('show');
  
  // Close on outside click
  const closeDropdown = (e) => {
    if (!e.target.closest('.dropdown')) {
      dropdown.classList.remove('show');
      document.removeEventListener('click', closeDropdown);
    }
  };
  document.addEventListener('click', closeDropdown);
}

// Toast System
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast-notification');
  const icon = toast.querySelector('.toast-icon');
  const message = toast.querySelector('.toast-message');
  
  message.textContent = msg;
  if (isError) {
    toast.classList.add('error');
    icon.className = 'fa-solid fa-circle-exclamation toast-icon';
  } else {
    toast.classList.remove('error');
    icon.className = 'fa-solid fa-circle-check toast-icon';
  }
  
  toast.classList.remove('hidden');
  
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

// Log Audits
function addAuditLog(type, msg) {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  state.logs.unshift({ time: timeStr, type, msg });
  
  // Keep logs to max 100
  if (state.logs.length > 100) state.logs.pop();
  
  // Update view if dashboard logs are visible
  updateLogsUI();
}

// ================= AUTHENTICATION FLOWS =================

function switchAuthTab(tab) {
  const loginTab = document.getElementById('tab-login-btn');
  const regTab = document.getElementById('tab-register-btn');
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');
  
  if (tab === 'login') {
    loginTab.classList.add('active');
    regTab.classList.remove('active');
    loginForm.classList.add('active');
    regForm.classList.remove('active');
  } else {
    loginTab.classList.remove('active');
    regTab.classList.add('active');
    loginForm.classList.remove('active');
    regForm.classList.add('active');
  }
}

function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  
  // Detect device
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const device = isMobile ? 'Mobile' : 'PC/Desktop (Browser)';

  fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass, device })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      state.currentUser = data.user;
      localStorage.setItem('nusagis_session', JSON.stringify(data.user));
      
      addAuditLog('user', `User ${data.user.email} logged in. Device: ${data.user.device}`);
      
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('main-workspace').classList.remove('hidden');
      
      showToast(`Selamat datang kembali, ${data.user.name}!`);
      initAppLayout();
    } else {
      showToast(data.message, true);
    }
  })
  .catch(err => {
    showToast('Koneksi backend gagal: ' + err.message, true);
  });
}

function handleRegister(event) {
  event.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-password').value;
  
  if (pass.length < 6) {
    showToast('Password minimal 6 karakter!', true);
    return;
  }

  fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name, password: pass })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      addAuditLog('system', `Registrasi akun baru berhasil: ${email}`);
      showToast('Daftar Akun Berhasil! Silakan masuk dengan akun Anda.');
      switchAuthTab('login');
      document.getElementById('login-email').value = email;
    } else {
      showToast(data.message, true);
    }
  })
  .catch(err => {
    showToast('Koneksi register gagal: ' + err.message, true);
  });
}

function handleLogout() {
  if (state.currentUser) {
    const email = state.currentUser.email;
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    }).catch(e => console.error(e));
  }
  
  state.currentUser = null;
  localStorage.removeItem('nusagis_session');
  
  document.getElementById('main-workspace').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  
  // Reset maps
  if (mainMap) {
    mainMap.remove();
    mainMap = null;
  }
  
  showToast('Anda telah keluar dari aplikasi.');
}

// ================= MAP MANAGEMENT & BASEMAPS =================

function initAppLayout() {
  // Check admin rights
  const adminBtn = document.getElementById('admin-dashboard-btn');
  if (state.currentUser && state.currentUser.role === 'admin') {
    adminBtn.classList.remove('hidden');
  } else {
    adminBtn.classList.add('hidden');
  }

  // Initializing Main Leaflet Map
  initMainMap();

  // Sidebar controls
  const sidebar = document.getElementById('sidebar-left');
  const toggleBtn = document.getElementById('sidebar-toggle');
  
  toggleBtn.onclick = () => {
    sidebar.classList.toggle('collapsed');
    setTimeout(() => {
      if (mainMap) mainMap.invalidateSize();
    }, 300);
  };
  
  // Active Layer Selection Handler
  const layerSelect = document.getElementById('active-layer-select');
  layerSelect.onchange = (e) => {
    state.activeLayer = e.target.value;
    showToast(`Layer aktif diganti ke: ${layerSelect.options[layerSelect.selectedIndex].text}`);
  };

  // Render stats counters
  updateStatsCounters();
}

function initMainMap() {
  if (mainMap) return;

  // Initialize Map canvas (Centered at standard Indonesian coordinate)
  mainMap = L.map('map', {
    zoomControl: false // custom position zoom
  }).setView([-2.5489, 118.0149], 5); // Center Indonesia

  // Add zoom control to top-left
  L.control.zoom({ position: 'topleft' }).addTo(mainMap);

  // Basemap Tiles
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  });

  const esriSatelit = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  });

  const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    attribution: '© Google Maps'
  });

  // Default basemap is OSM
  osm.addTo(mainMap);

  // Store references for basemap toggling
  baseLayers = {
    "OSM": osm,
    "Satelit Esri": esriSatelit,
    "Google Hybrid": googleHybrid
  };

  // Add Layer Control (Top Right)
  const baseControls = {
    "🛣️ OpenStreetMap (OSM)": osm,
    "🛰️ Citra Esri": esriSatelit,
    "🏙️ Google Hybrid": googleHybrid
  };

  // Instantiate Layer Groups
  mapLayers.survey_points = L.layerGroup().addTo(mainMap);
  mapLayers.digitized_lines = L.layerGroup().addTo(mainMap);
  mapLayers.digitized_polygons = L.layerGroup().addTo(mainMap);
  mapLayers.imported = L.layerGroup().addTo(mainMap);
  mapLayers.ruler = L.layerGroup().addTo(mainMap);
  mapLayers.sql_visualizer = L.layerGroup().addTo(mainMap);

  const overlays = {
    "📍 Titik RTK": mapLayers.survey_points,
    "📐 Digitasi Garis": mapLayers.digitized_lines,
    "⬡ Digitasi Area": mapLayers.digitized_polygons,
    "📁 Layer Impor": mapLayers.imported
  };

  L.control.layers(baseControls, overlays, { position: 'topright' }).addTo(mainMap);

  // Load existing features from MySQL database onto layers
  loadGISDataFromServer();

  // Leaflet.Geoman Setup (Manual Digitizing and Snapping)
  mainMap.pm.addControls({
    position: 'topleft',
    drawMarker: true,
    drawCircleMarker: false,
    drawPolyline: true,
    drawRectangle: false,
    drawPolygon: true,
    drawCircle: false,
    editMode: true,
    dragMode: false,
    cutPolygon: false,
    removalMode: true
  });

  // Setup snapping options
  mainMap.pm.setGlobalOptions({
    snapping: true,
    snapDistance: 20,
    allowSelfIntersection: false,
    templineStyle: { color: '#8b5cf6' },
    hintlineStyle: { color: '#8b5cf6', dashArray: [5, 5] }
  });

  // Listen to draw creation
  mainMap.on('pm:create', (e) => {
    const layer = e.layer;
    const type = e.shape; // 'Marker', 'Line', 'Polygon'
    
    // Determine active collection & target group
    let dbKey = '';
    let targetGroup = null;
    let label = '';

    if (type === 'Marker') {
      dbKey = 'survey_points';
      targetGroup = mapLayers.survey_points;
      label = `Titik Digitasi ${state.database.survey_points.length + 1}`;
      
      // Bind descriptive popup immediately
      layer.bindPopup(`<strong>${label}</strong><br>Digitasi Manual`);
    } else if (type === 'Line') {
      dbKey = 'digitized_lines';
      targetGroup = mapLayers.digitized_lines;
      label = `Garis ${state.database.digitized_lines.length + 1}`;
      layer.setStyle({ color: '#3b82f6', weight: 4 });
    } else if (type === 'Polygon') {
      dbKey = 'digitized_polygons';
      targetGroup = mapLayers.digitized_polygons;
      label = `Area ${state.database.digitized_polygons.length + 1}`;
      layer.setStyle({ color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.4, weight: 2 });
    }

    if (dbKey && targetGroup) {
      // Add custom identifier
      layer.featureId = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7);
      layer.label = label;
      
      // Transfer to permanent layer group
      targetGroup.addLayer(layer);
      
      // Save geometry to state
      const geojsonFeature = layer.toGeoJSON();
      geojsonFeature.id = layer.featureId;
      geojsonFeature.properties = {
        name: label,
        description: 'Digitasi On-screen',
        time: new Date().toISOString()
      };
      
      state.database[dbKey].push(geojsonFeature);
      saveDatabaseToStorage();
      updateStatsCounters();
      
      showToast(`${label} berhasil digambar.`);
      addAuditLog('spatial', `Menggambar manual objek: ${label} (${type})`);
    }
  });

  // Handle Edit and Deletions via Geoman
  mainMap.on('pm:remove', (e) => {
    const layer = e.layer;
    const fid = layer.featureId;
    if (!fid) return;
    
    // Find and delete from database lists
    let deleted = false;
    ['survey_points', 'digitized_lines', 'digitized_polygons'].forEach(key => {
      const idx = state.database[key].findIndex(f => f.id === fid);
      if (idx !== -1) {
        state.database[key].splice(idx, 1);
        deleted = true;
      }
    });

    if (deleted) {
      saveDatabaseToStorage();
      updateStatsCounters();
      showToast('Objek berhasil dihapus.');
      addAuditLog('spatial', 'Menghapus objek spasial lewat visual editor.');
    }
  });

  // Listen to coordinate movements
  mainMap.on('mousemove', (e) => {
    const lat = e.latlng.lat.toFixed(8);
    const lng = e.latlng.lng.toFixed(8);
    document.getElementById('val-lat').textContent = lat;
    document.getElementById('val-lng').textContent = lng;
  });

  mainMap.on('zoomend', () => {
    document.getElementById('val-zoom').textContent = mainMap.getZoom();
  });

  // Custom Ruler button in Leaflet pm toolbar
  const customRulerAction = () => {
    toggleRulerMode();
  };

  // Add custom ruler button on map controls
  L.Control.RulerBtn = L.Control.extend({
    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const button = L.DomUtil.create('button', '', container);
      button.innerHTML = '<i class="fa-solid fa-ruler"></i>';
      button.title = "Pengukur Jarak (Ruler)";
      button.style.fontSize = '14px';
      button.style.width = '30px';
      button.style.height = '30px';
      button.style.cursor = 'pointer';
      button.style.display = 'flex';
      button.style.justifyContent = 'center';
      button.style.alignItems = 'center';
      button.style.background = 'var(--bg-panel)';
      button.style.color = 'var(--color-text)';
      button.style.border = 'none';

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(button, 'click', (e) => {
        L.DomEvent.stop(e);
        customRulerAction();
      });

      return container;
    }
  });

  new L.Control.RulerBtn({ position: 'topleft' }).addTo(mainMap);

  // Disable click propagation on overlays to prevent triggering map clicks
  L.DomEvent.disableClickPropagation(document.getElementById('ruler-result-box'));
  L.DomEvent.disableClickPropagation(document.querySelector('.coords-bar'));
  L.DomEvent.disableClickPropagation(document.getElementById('floating-rec-btn'));
}

function renderStoredGeometries() {
  // Clear map layers
  mapLayers.survey_points.clearLayers();
  mapLayers.digitized_lines.clearLayers();
  mapLayers.digitized_polygons.clearLayers();

  // Load points
  state.database.survey_points.forEach(feat => {
    const coords = feat.geometry.coordinates; // [lng, lat]
    const p = L.marker([coords[1], coords[0]], {
      icon: L.divIcon({
        className: 'custom-rtk-pin',
        html: '<div style="background-color: #ef4444; border: 2px solid white; width:12px; height:12px; border-radius:50%; box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      })
    });
    p.featureId = feat.id;
    p.label = feat.properties.name;
    p.bindPopup(`
      <strong>📍 ID Titik: ${feat.properties.name}</strong><br>
      Elevasi H: ${feat.properties.elevation || '0.0'} m<br>
      Solusi: <span class="badge badge-green">${feat.properties.solution || 'Fix'}</span><br>
      Waktu: ${new Date(feat.properties.time).toLocaleString()}
    `);
    mapLayers.survey_points.addLayer(p);
  });

  // Load lines
  state.database.digitized_lines.forEach(feat => {
    const coords = feat.geometry.coordinates.map(c => [c[1], c[0]]); // [[lat, lng]]
    const polyline = L.polyline(coords, { color: '#3b82f6', weight: 4 });
    polyline.featureId = feat.id;
    polyline.label = feat.properties.name;
    mapLayers.digitized_lines.addLayer(polyline);
  });

  // Load polygons
  state.database.digitized_polygons.forEach(feat => {
    const coords = feat.geometry.coordinates[0].map(c => [c[1], c[0]]); // [[lat, lng]]
    const polygon = L.polygon(coords, { color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.4, weight: 2 });
    polygon.featureId = feat.id;
    polygon.label = feat.properties.name;
    mapLayers.digitized_polygons.addLayer(polygon);
  });
}

function saveDatabaseToStorage() {
  localStorage.setItem('nusagis_db', JSON.stringify(state.database));
}

function updateStatsCounters() {
  document.getElementById('stat-points-count').textContent = state.database.survey_points.length;
  document.getElementById('stat-lines-count').textContent = state.database.digitized_lines.length;
  document.getElementById('stat-poly-count').textContent = state.database.digitized_polygons.length;
}

function toggleGISLayer(layerKey) {
  const toggle = document.getElementById(`layer-${layerKey === 'survey_points' ? 'rtk' : layerKey === 'digitized_lines' ? 'lines' : 'polygons'}-toggle`);
  const layer = mapLayers[layerKey];
  
  if (toggle.checked) {
    mainMap.addLayer(layer);
  } else {
    mainMap.removeLayer(layer);
  }
}

function changeLayerOpacity(layerKey, opacityVal) {
  const opacity = opacityVal / 100;
  const layer = mapLayers[layerKey];
  
  layer.eachLayer(l => {
    if (l.setStyle) {
      l.setStyle({ opacity: opacity, fillOpacity: opacity * 0.5 });
    } else if (l.setOpacity) {
      l.setOpacity(opacity);
    }
  });
}

function clearLocalGeometries() {
  if (confirm("🚨 Apakah Anda yakin ingin menghapus seluruh geometri spasial yang terekam secara lokal di browser?")) {
    state.database.survey_points = [];
    state.database.digitized_lines = [];
    state.database.digitized_polygons = [];
    state.database.imported_layers = {};
    saveDatabaseToStorage();
    renderStoredGeometries();
    updateStatsCounters();
    showToast('Seluruh geometri lokal telah dibersihkan!');
    addAuditLog('system', 'Melakukan reset database spasial lokal.');
  }
}

// ================= RULER TOOL (DISTANCE & AZIMUTH) =================

function toggleRulerMode() {
  if (state.rulerActive) {
    deactivateRuler();
  } else {
    activateRuler();
  }
}

function activateRuler() {
  state.rulerActive = true;
  state.rulerPoints = [];
  document.getElementById('ruler-result-box').classList.remove('hidden');
  document.getElementById('ruler-distance').textContent = "0.00 m";
  document.getElementById('ruler-azimuth').textContent = "0.00°";
  
  mainMap.pm.disableDraw();
  mainMap.getContainer().style.cursor = 'crosshair';
  
  // Register click events for custom ruler
  mainMap.on('click', handleRulerClick);
  mainMap.on('dblclick', handleRulerDblClick);
  
  showToast('Ruler diaktifkan. Klik di peta untuk mengukur.');
}

function deactivateRuler() {
  state.rulerActive = false;
  document.getElementById('ruler-result-box').classList.add('hidden');
  mainMap.getContainer().style.cursor = '';
  
  // Unbind events
  mainMap.off('click', handleRulerClick);
  mainMap.off('dblclick', handleRulerDblClick);
  
  // Clean drawing layers
  mapLayers.ruler.clearLayers();
  state.rulerPoints = [];
  
  showToast('Ruler dinonaktifkan.');
}

function handleRulerClick(e) {
  const latlng = e.latlng;
  state.rulerPoints.push(latlng);
  
  // Add a marker node
  const marker = L.circleMarker(latlng, {
    radius: 5,
    color: '#f59e0b',
    fillColor: '#fff',
    fillOpacity: 1
  }).addTo(mapLayers.ruler);
  
  if (state.rulerPoints.length > 1) {
    const prev = state.rulerPoints[state.rulerPoints.length - 2];
    
    // Draw connecting line
    L.polyline([prev, latlng], {
      color: '#f59e0b',
      weight: 3,
      dashArray: '5, 5'
    }).addTo(mapLayers.ruler);
    
    // Calculate distance & bearing/azimuth
    const distanceMeters = mainMap.distance(prev, latlng);
    const azimuth = calculateAzimuth(prev, latlng);
    
    // Calculate total accumulated distance
    let totalDist = 0;
    for (let i = 1; i < state.rulerPoints.length; i++) {
      totalDist += mainMap.distance(state.rulerPoints[i-1], state.rulerPoints[i]);
    }
    
    const distText = totalDist > 1000 ? (totalDist / 1000).toFixed(3) + " km" : totalDist.toFixed(2) + " m";
    document.getElementById('ruler-distance').textContent = distText;
    document.getElementById('ruler-azimuth').textContent = azimuth.toFixed(2) + "°";
    
    // Add temporary midpoint measurement display label
    marker.bindTooltip(`${distanceMeters.toFixed(1)}m | Az: ${azimuth.toFixed(0)}°`, {
      permanent: true,
      direction: 'top',
      className: 'ruler-tooltip-lbl'
    }).openTooltip();
  }
}

function handleRulerDblClick(e) {
  // Stop and lock path
  deactivateRuler();
}

function calculateAzimuth(p1, p2) {
  const d2r = Math.PI / 180;
  const r2d = 180 / Math.PI;
  
  const lat1 = p1.lat * d2r;
  const lat2 = p2.lat * d2r;
  const dLng = (p2.lng - p1.lng) * d2r;
  
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  
  let bearing = Math.atan2(y, x) * r2d;
  return (bearing + 360) % 360;
}

// ================= GNSS / RTK REALTIME RECORDING =================

function startGNSSAccuracySimulation() {
  const steps = [
    { mode: 'Single', accuracy: '3.2m', color: 'badge-single', status: 'DGPS' },
    { mode: 'DGPS', accuracy: '1.2m', color: 'badge-float', status: 'Float' },
    { mode: 'Float', accuracy: '0.45m', color: 'badge-float', status: 'Fix' },
    { mode: 'Fix', accuracy: '0.008m', color: 'badge-fix', status: 'Locked' }
  ];
  
  let i = 0;
  const interval = setInterval(() => {
    if (i < steps.length) {
      const step = steps[i];
      state.gnssAccuracy = step.mode;
      
      const rtkText = document.getElementById('rtk-mode-text');
      rtkText.textContent = `GNSS: ${step.mode} (${step.accuracy})`;
      
      i++;
    } else {
      clearInterval(interval);
      // Locked state, show blinking REC button
      document.getElementById('floating-rec-btn').classList.remove('hidden');
      addAuditLog('system', 'Koneksi RTK Rover Terkunci (Fix Solution). Akurasi H: 8mm | V: 15mm.');
      showToast('Sinyal GNSS RTK Terkunci (Fix)! Presisi 8 milimeter. Siap merekam.');
    }
  }, 1500);
}

function openRTKModal() {
  // Use map center as fallback GPS coordinate, or actual browser geo if enabled
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      state.gnssCoords.lat = pos.coords.latitude;
      state.gnssCoords.lng = pos.coords.longitude;
      state.gnssCoords.elevation = pos.coords.altitude || 28.5;
      updateRTKModalCoords();
    }, () => {
      // Map Center Fallback
      const center = mainMap.getCenter();
      state.gnssCoords.lat = center.lat;
      state.gnssCoords.lng = center.lng;
      updateRTKModalCoords();
    }, { enableHighAccuracy: true });
  } else {
    const center = mainMap.getCenter();
    state.gnssCoords.lat = center.lat;
    state.gnssCoords.lng = center.lng;
    updateRTKModalCoords();
  }
  
  document.getElementById('rtk-modal').classList.remove('hidden');
  
  // Suggest ID Point
  document.getElementById('rtk-point-id').value = `T.${String(state.database.survey_points.length + 1).padStart(3, '0')}`;
}

function updateRTKModalCoords() {
  document.getElementById('form-locked-lat').textContent = state.gnssCoords.lat.toFixed(8);
  document.getElementById('form-locked-lng').textContent = state.gnssCoords.lng.toFixed(8);
  
  // Update ground altitude
  document.getElementById('rtk-h-ground').value = state.gnssCoords.elevation.toFixed(3);
  const undulation = parseFloat(document.getElementById('rtk-n-geoid').value);
  document.getElementById('rtk-h-ortho').value = (state.gnssCoords.elevation - undulation).toFixed(3);
}

function closeRTKModal() {
  document.getElementById('rtk-modal').classList.add('hidden');
}

function adjustAntennaAccuracyStatus(solution) {
  const badge = document.getElementById('rtk-accuracy-display');
  badge.className = 'accuracy-badge';
  
  if (solution === 'Fix') {
    badge.classList.add('badge-fix');
    badge.innerHTML = "H: 0.008m | V: 0.015m";
  } else if (solution === 'Float') {
    badge.classList.add('badge-float');
    badge.innerHTML = "H: 0.35m | V: 0.62m";
  } else if (solution === 'DGPS') {
    badge.classList.add('badge-float');
    badge.innerHTML = "H: 1.25m | V: 2.10m";
  } else {
    badge.classList.add('badge-single');
    badge.innerHTML = "H: 5.4m | V: 9.8m";
  }
}

function saveRTKPoint(event) {
  event.preventDefault();
  
  const idPoint = document.getElementById('rtk-point-id').value.trim();
  const description = document.getElementById('rtk-desc').value.trim();
  const hGround = parseFloat(document.getElementById('rtk-h-ground').value);
  const hOrtho = parseFloat(document.getElementById('rtk-h-ortho').value);
  const undulation = parseFloat(document.getElementById('rtk-n-geoid').value);
  const antHeight = parseFloat(document.getElementById('ant-height').value);
  const antOffset = document.getElementById('ant-offset').value;
  const antType = document.getElementById('ant-type').value;
  const solution = document.getElementById('rtk-solution').value;
  
  // Construct GeoJSON Feature
  const featId = 'rtk_' + Date.now();
  const pointFeature = {
    type: "Feature",
    id: featId,
    geometry: {
      type: "Point",
      coordinates: [state.gnssCoords.lng, state.gnssCoords.lat]
    },
    properties: {
      name: idPoint,
      description: description,
      h_ground: hGround,
      elevation: hOrtho, // primary elevation used in GIS
      undulation: undulation,
      ant_height: antHeight,
      ant_offset: antOffset,
      ant_type: antType,
      solution: solution,
      time: new Date().toISOString(),
      surveyor: state.currentUser ? state.currentUser.name : 'Guest'
    }
  };

  // Push to local db state
  state.database.survey_points.push(pointFeature);
  saveDatabaseToStorage();
  updateStatsCounters();
  
  // Render on main map instantly
  const p = L.marker([state.gnssCoords.lat, state.gnssCoords.lng], {
    icon: L.divIcon({
      className: 'custom-rtk-pin',
      html: '<div style="background-color: #ef4444; border: 2px solid white; width:12px; height:12px; border-radius:50%; box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    })
  });
  p.featureId = featId;
  p.label = idPoint;
  p.bindPopup(`
    <strong>📍 ID Titik: ${idPoint}</strong><br>
    Elevasi H: ${hOrtho.toFixed(3)} m<br>
    Solusi: <span class="badge badge-green">${solution}</span><br>
    Waktu: ${new Date().toLocaleString()}
  `);
  
  mapLayers.survey_points.addLayer(p);
  
  // Pan map to new point
  mainMap.panTo([state.gnssCoords.lat, state.gnssCoords.lng]);

  closeRTKModal();
  showToast(`Titik ${idPoint} berhasil direkam ke Database Realtime!`);
  addAuditLog('spatial', `Merekam titik RTK GNSS: ${idPoint} (Solusi: ${solution})`);
  
  // Simulate active synchronization to administrative dashboard
  triggerQuickSave();
}

function saveDatabaseToStorage() {
  localStorage.setItem('nusagis_db', JSON.stringify(state.database));
  pushGISDataToServer();
}

function pushGISDataToServer() {
  fetch('/api/data/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      survey_points: state.database.survey_points,
      digitized_lines: state.database.digitized_lines,
      digitized_polygons: state.database.digitized_polygons
    })
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) {
      console.error('MySQL Sync error:', data.message);
    }
  })
  .catch(err => {
    console.error('MySQL connection error:', err);
  });
}

function loadGISDataFromServer() {
  fetch('/api/data')
  .then(res => res.json())
  .then(data => {
    state.database.survey_points = data.survey_points;
    state.database.digitized_lines = data.digitized_lines;
    state.database.digitized_polygons = data.digitized_polygons;
    
    renderStoredGeometries();
    updateStatsCounters();
  })
  .catch(err => {
    showToast('Gagal memuat data dari database MySQL!', true);
  });
}

function triggerQuickSave() {
  const syncBtn = document.getElementById('quick-save-btn');
  const syncDot = document.querySelector('.status-dot');
  
  syncBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  syncDot.style.backgroundColor = '#f59e0b';
  
  fetch('/api/data/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      survey_points: state.database.survey_points,
      digitized_lines: state.database.digitized_lines,
      digitized_polygons: state.database.digitized_polygons
    })
  })
  .then(res => res.json())
  .then(data => {
    syncBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Instan';
    if (data.success) {
      syncDot.style.backgroundColor = '#10b981';
      showToast('Data berhasil disinkronisasikan ke MySQL Database!');
      addAuditLog('system', 'Melakukan sinkronisasi data lapangan ke MySQL.');
    } else {
      showToast('Gagal sinkronisasi: ' + data.message, true);
    }
  })
  .catch(err => {
    syncBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Instan';
    syncDot.style.backgroundColor = '#ef4444';
    showToast('Koneksi MySQL terputus!', true);
  });
}

// ================= SHAPEFILE IMPORT & DATA EXPORT =================

function openImportModal() {
  document.getElementById('import-modal').classList.remove('hidden');
}

function closeImportModal() {
  document.getElementById('import-modal').classList.add('hidden');
  document.getElementById('import-progress-container').classList.add('hidden');
}

async function handleImportData(event) {
  event.preventDefault();
  const fileInput = document.getElementById('import-file');
  const layerName = document.getElementById('import-layer-name').value.trim() || 'Layer_Impor_' + Date.now().toString().slice(-4);
  const geomType = document.getElementById('import-geom-type').value;
  
  if (!fileInput.files.length) {
    showToast('Pilih file terlebih dahulu!', true);
    return;
  }
  
  const file = fileInput.files[0];
  const progressContainer = document.getElementById('import-progress-container');
  const progressFill = document.getElementById('import-progress-fill');
  const progressText = document.getElementById('import-progress-status');
  
  progressContainer.classList.remove('hidden');
  progressFill.style.width = '10%';
  progressText.textContent = 'Membaca file berkas...';

  try {
    if (file.name.endsWith('.geojson')) {
      // Direct GeoJSON Parse
      progressFill.style.width = '50%';
      progressText.textContent = 'Mengurai GeoJSON...';
      
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const geojson = JSON.parse(e.target.result);
          processAndAddImportedLayer(geojson, layerName);
          
          progressFill.style.width = '100%';
          progressText.textContent = 'Sukses mengimpor!';
          setTimeout(() => {
            closeImportModal();
            showToast(`GeoJSON ${layerName} berhasil diimpor!`);
          }, 800);
        } catch(err) {
          showToast('File GeoJSON tidak valid/corrupt!', true);
          closeImportModal();
        }
      };
      reader.readAsText(file);
      
    } else if (file.name.endsWith('.zip')) {
      // ZIP containing shapefiles (.shp, .shx, .dbf, .prj)
      progressFill.style.width = '30%';
      progressText.textContent = 'Mengekstrak Shapefile ZIP...';
      
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const arrayBuffer = e.target.result;
          
          progressFill.style.width = '60%';
          progressText.textContent = 'Menganalisis Geometri Shapefile...';
          
          // Parse ZIP with shpjs
          const geojson = await shp(arrayBuffer);
          
          progressFill.style.width = '90%';
          progressText.textContent = 'Menyusun visual layer...';
          
          processAndAddImportedLayer(geojson, layerName);
          
          progressFill.style.width = '100%';
          progressText.textContent = 'Selesai!';
          
          setTimeout(() => {
            closeImportModal();
            showToast(`Shapefile ${layerName} berhasil diimpor!`);
          }, 800);
          
        } catch (err) {
          console.error(err);
          showToast('ZIP tidak valid. Pastikan berisi minimal berkas .shp, .shx, .dbf!', true);
          closeImportModal();
        }
      };
      reader.readAsArrayBuffer(file);
    }
  } catch (err) {
    showToast('Impor gagal: ' + err.message, true);
    closeImportModal();
  }
}

function processAndAddImportedLayer(geojson, layerName) {
  // Add to state storage
  state.database.imported_layers[layerName] = geojson;
  saveDatabaseToStorage();
  
  // Render on main map
  const customLayer = L.geoJSON(geojson, {
    style: function (feature) {
      return { color: '#f59e0b', weight: 3, fillOpacity: 0.35, fillColor: '#f59e0b' };
    },
    pointToLayer: function(feature, latlng) {
      return L.circleMarker(latlng, {
        radius: 6,
        fillColor: "#f59e0b",
        color: "#fff",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });
    },
    onEachFeature: function(feature, layer) {
      // Bind descriptive label popup
      let desc = "<strong>Layer Impor: " + layerName + "</strong>";
      if (feature.properties) {
        desc += "<hr><div style='max-height:100px; overflow-y:auto; font-size:11px;'>";
        for (let k in feature.properties) {
          desc += `<b>${k}:</b> ${feature.properties[k]}<br>`;
        }
        desc += "</div>";
      }
      layer.bindPopup(desc);
    }
  }).addTo(mapLayers.imported);
  
  // Focus bounds to imported layer
  try {
    mainMap.fitBounds(customLayer.getBounds());
  } catch (e) {}

  // Update TOC list dynamically
  const container = document.getElementById('imported-layers-container');
  const cleanId = 'imp_' + layerName.replace(/[^a-zA-Z0-9]/g, '_');
  
  const layerRowHtml = `
    <div class="toc-item" id="toc-item-${cleanId}">
      <div class="toc-row">
        <input type="checkbox" id="check-${cleanId}" checked>
        <span class="legend-polygon" style="background-color:rgba(245,158,11,0.3); border:1.5px solid #f59e0b"></span>
        <span class="layer-label">${layerName}</span>
        <button class="btn btn-red-outline btn-xs" onclick="deleteImportedLayer('${layerName}', '${cleanId}')" title="Hapus"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', layerRowHtml);
  
  // Setup checkbox toggle event
  document.getElementById(`check-${cleanId}`).onchange = (e) => {
    if (e.target.checked) {
      mainMap.addLayer(customLayer);
    } else {
      mainMap.removeLayer(customLayer);
    }
  };
  
  // Store layer reference for dynamic deletion
  mapLayers.imported[layerName] = customLayer;
  
  addAuditLog('spatial', `Shapefile/GeoJSON berhasil diimpor: ${layerName}`);
}

function deleteImportedLayer(layerName, elementId) {
  if (confirm(`Hapus layer impor ${layerName}?`)) {
    // Remove from map
    if (mapLayers.imported[layerName]) {
      mainMap.removeLayer(mapLayers.imported[layerName]);
      delete mapLayers.imported[layerName];
    }
    
    // Remove from storage
    delete state.database.imported_layers[layerName];
    saveDatabaseToStorage();
    
    // Remove from TOC UI
    document.getElementById(`toc-item-${elementId}`).remove();
    showToast(`Layer ${layerName} dihapus.`);
  }
}

// Data Export Utilities
function exportData(format) {
  if (format === 'geojson') {
    // Merge database features into Single GeoJSON
    const featureCollection = {
      type: "FeatureCollection",
      features: [
        ...state.database.survey_points,
        ...state.database.digitized_lines,
        ...state.database.digitized_polygons
      ]
    };
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(featureCollection, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `NusaGIS_Project_${Date.now()}.geojson`);
    dlAnchorElem.click();
    showToast('Unduhan GeoJSON sukses dimulai!');
    addAuditLog('system', 'Mengekspor berkas proyek ke format GeoJSON.');
    
  } else if (format === 'xlsx') {
    // Export points table
    const pointsData = state.database.survey_points.map(f => {
      const coords = f.geometry.coordinates;
      return {
        "ID Titik": f.properties.name,
        "Latitude": coords[1],
        "Longitude": coords[0],
        "H Ground (m)": f.properties.h_ground || 0,
        "H Ortho / Elevasi (m)": f.properties.elevation || 0,
        "Geoid Undulasi (m)": f.properties.undulation || 0,
        "Tinggi Antena (m)": f.properties.ant_height || 0,
        "Antena Offset": f.properties.ant_offset || "0.00",
        "Tipe Rover": f.properties.ant_type || "",
        "Koneksi RTK": f.properties.solution || "",
        "Deskripsi": f.properties.description || "",
        "Waktu Perekaman": f.properties.time || "",
        "Surveyor": f.properties.surveyor || ""
      };
    });

    if (!pointsData.length) {
      showToast('Tidak ada data Titik Survei RTK untuk diekspor ke Excel!', true);
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(pointsData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Titik Survei RTK");
    
    // Save xlsx file
    XLSX.writeFile(workbook, `NusaGIS_Laporan_Survei_${Date.now()}.xlsx`);
    showToast('Laporan Excel (.xlsx) sukses diunduh!');
    addAuditLog('system', 'Mengekspor laporan survei lapangan ke format Excel.');
    
  } else if (format === 'shp') {
    // Shapefile exporter simulator: Client-side ZIP containing shape database tables and shape GeoJSON
    // Since compilation of actual .shp binary files is extremely heavy client side,
    // we bundle standard DBF structure inside a CSV, clean GeoJSON, and prj files inside a ZIP
    const zip = new JSZip();
    
    const metadata = {
      app: "NusaGIS RealTime Mapping",
      date: new Date().toISOString(),
      srs: "WGS 84 (EPSG:4326)",
      license: state.currentUser ? state.currentUser.license : 'Demo-Trial'
    };
    
    zip.file("README_GIS_IMPORT.txt", `=== NUSAGIS GIS DATA EXPORT ===
Tanggal Eksport: ${metadata.date}
Sistem Referensi Spasial (SRS): ${metadata.srs}

Panduan Impor ArcGIS/QGIS:
1. File 'shapes_data.geojson' adalah representasi spasial akurasi tinggi dari seluruh data lapangan Anda.
2. File 'table_attributes.csv' berisi tabel data mentah surveyor, tinggi antena, elevasi orthometrik, dan status solusi RTK.
3. Impor data GeoJSON langsung ke workspace ArcGIS/QGIS Anda. Field akan terisi sesuai tabel.
`);
    
    zip.file("shapes_data.geojson", JSON.stringify({
      type: "FeatureCollection",
      features: [
        ...state.database.survey_points,
        ...state.database.digitized_lines,
        ...state.database.digitized_polygons
      ]
    }, null, 2));

    // Compile points database table
    let csvData = "id,name,latitude,longitude,elevation,solution,antenna_height,description,time,surveyor\n";
    state.database.survey_points.forEach(f => {
      const coords = f.geometry.coordinates;
      csvData += `"${f.id}","${f.properties.name}",${coords[1]},${coords[0]},${f.properties.elevation},"${f.properties.solution}",${f.properties.ant_height},"${f.properties.description || ''}","${f.properties.time}","${f.properties.surveyor}"\n`;
    });
    zip.file("table_attributes.csv", csvData);
    
    // Generate projection metadata
    zip.file("shapes_data.prj", `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`);

    zip.generateAsync({type:"blob"}).then(function(content) {
      const dlAnchorElem = document.createElement('a');
      dlAnchorElem.href = URL.createObjectURL(content);
      dlAnchorElem.download = `NusaGIS_Shapefile_ZIP_${Date.now()}.zip`;
      dlAnchorElem.click();
    });
    
    showToast('Shapefile interoperabilitas ZIP diunduh!');
    addAuditLog('system', 'Mengekspor data spasial ke Shapefile interoperabilitas ZIP.');
  }
}

// ================= BOOK GUIDE DIALOGS =================

function openGuideModal() {
  document.getElementById('guide-modal').classList.remove('hidden');
}
function closeGuideModal() {
  document.getElementById('guide-modal').classList.add('hidden');
}

// ================= CENTRAL ADMIN DASHBOARD & RADAR =================

function openAdminDashboard() {
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    showToast('Akses Ditolak: Hanya Akun Administrator Berlisensi Khusus!', true);
    return;
  }

  document.getElementById('admin-dashboard').classList.remove('hidden');
  
  // Initialize internal maps inside dashboard
  setTimeout(() => {
    initDashboardRadarMap();
    initSQLPreviewMap();
  }, 300);

  // Update tabs contents
  renderSurveyorsTable();
  renderLicensesTable();
  renderLeadsTable();
  updateLogsUI();
  
  addAuditLog('admin', 'Administrator membuka panel kendali pusat.');
}

function closeAdminDashboard() {
  document.getElementById('admin-dashboard').classList.add('hidden');
  
  // Stop surveyor coordinate simulation mapping
  if (surveyorSimulationInterval) {
    clearInterval(surveyorSimulationInterval);
    surveyorSimulationInterval = null;
  }
}

function switchDashboardTab(tabName) {
  // Navigation active tab
  const tabs = document.querySelectorAll('.dashboard-nav .nav-tab');
  tabs.forEach(tab => tab.classList.remove('active'));
  
  // Panel view active
  const panels = document.querySelectorAll('.dashboard-panel-container .db-tab-panel');
  panels.forEach(p => p.classList.remove('active'));

  // Set active
  const selectedPanel = document.getElementById(`db-tab-${tabName}`);
  selectedPanel.classList.add('active');
  
  // Find matching nav button
  const matchingNavBtn = Array.from(tabs).find(t => t.getAttribute('onclick').includes(tabName));
  if (matchingNavBtn) matchingNavBtn.classList.add('active');

  // Trigger internal map updates for layout fixes
  if (tabName === 'radar' && radarMap) {
    setTimeout(() => radarMap.invalidateSize(), 100);
  }
  if (tabName === 'sql' && sqlPreviewMap) {
    setTimeout(() => sqlPreviewMap.invalidateSize(), 100);
  }
}

// Tab 1: Surveyor radar tracking
function initDashboardRadarMap() {
  if (radarMap) {
    radarMap.invalidateSize();
    startSurveyorPositionsSimulation();
    return;
  }

  // Centered at surveyor locations
  radarMap = L.map('radar-map', { zoomControl: false }).setView([-6.2088, 106.8456], 12);
  
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB'
  }).addTo(radarMap);

  startSurveyorPositionsSimulation();
}

function startSurveyorPositionsSimulation() {
  // Pre-seed tracking markers of online surveyors
  // Ahmad Surveyor (surveyor1) - Online moving around
  let ahmadLatLng = [-6.2088, 106.8456];
  let adminLatLng = [-6.2045, 106.8398]; // romigeodes
  
  // Draw surveyor marker icons
  radarMarkers.ahmad = L.marker(ahmadLatLng, {
    icon: L.divIcon({
      className: 'radar-marker-pulse',
      html: '<div style="background-color: #ef4444; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow: 0 0 10px #ef4444"></div>',
      iconSize: [12, 12]
    })
  }).addTo(radarMap).bindTooltip("Ahmad Surveyor (Mobile)", { permanent: true, direction: 'top' });

  radarMarkers.admin = L.marker(adminLatLng, {
    icon: L.divIcon({
      className: 'radar-marker-pulse',
      html: '<div style="background-color: #8b5cf6; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow: 0 0 10px #8b5cf6"></div>',
      iconSize: [12, 12]
    })
  }).addTo(radarMap).bindTooltip("Romi (PC Admin)", { permanent: true, direction: 'top' });

  // Update bounds
  const group = new L.featureGroup([radarMarkers.ahmad, radarMarkers.admin]);
  radarMap.fitBounds(group.getBounds().pad(0.2));

  // Run simulation interval
  if (surveyorSimulationInterval) clearInterval(surveyorSimulationInterval);
  
  surveyorSimulationInterval = setInterval(() => {
    // Ahmad moves slightly
    ahmadLatLng[0] += (Math.random() - 0.5) * 0.002;
    ahmadLatLng[1] += (Math.random() - 0.5) * 0.002;
    radarMarkers.ahmad.setLatLng(ahmadLatLng);
    
    // Admin moves very slightly
    adminLatLng[0] += (Math.random() - 0.5) * 0.0005;
    adminLatLng[1] += (Math.random() - 0.5) * 0.0005;
    radarMarkers.admin.setLatLng(adminLatLng);
  }, 3000);
}

function renderSurveyorsTable() {
  fetch('/api/admin/surveyors')
  .then(res => res.json())
  .then(users => {
    state.users = users;
    const tbody = document.querySelector('#surveyors-table tbody');
    tbody.innerHTML = '';
    
    let onlineCount = 0;

    users.forEach(usr => {
      const isOnline = usr.status === 'Online';
      if (isOnline) onlineCount++;

      const row = `
        <tr>
          <td><strong>${usr.name}</strong></td>
          <td>${usr.email}</td>
          <td><span class="badge badge-purple">${usr.license}</span></td>
          <td><i class="fa-solid ${usr.device && usr.device.includes('PC') ? 'fa-desktop' : 'fa-mobile-screen'}"></i> ${usr.device || 'PC'}</td>
          <td><span class="badge ${isOnline ? 'badge-green' : 'badge-red'}">${usr.status}</span></td>
          <td>
            ${isOnline && usr.email !== state.currentUser.email ? 
              `<button class="btn btn-red-outline btn-xs" onclick="forceLogoutUser('${usr.email}')"><i class="fa-solid fa-person-falling-burst"></i> Force Logout</button>` : 
              `<span class="color-muted">-</span>`
            }
          </td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', row);
    });

    document.getElementById('online-count-badge').textContent = `${onlineCount} Online`;
  })
  .catch(err => console.error(err));
}

function forceLogoutUser(email) {
  fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      showToast(`User ${email} berhasil dikeluarkan paksa!`);
      renderSurveyorsTable();
      addAuditLog('admin', `Administrator mengeluarkan paksa surveyor: ${email}`);
    }
  })
  .catch(err => console.error(err));
}

// Tab 2: Licenses & limits
function suggestLicenseCode() {
  const code = 'NusaGIS-' + Math.floor(1000 + Math.random() * 9000);
  document.getElementById('lic-code').value = code;
}

function generateLicense(event) {
  event.preventDefault();
  const code = document.getElementById('lic-code').value.trim();
  const quota = parseInt(document.getElementById('lic-quota').value);
  const client = document.getElementById('lic-client').value.trim();
  
  if (!code) {
    showToast('Generate kode lisensi terlebih dahulu!', true);
    return;
  }

  fetch('/api/admin/license/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, quota, client })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      showToast(`Lisensi ${code} berhasil dibuat!`);
      renderLicensesTable();
      document.getElementById('lic-code').value = '';
      document.getElementById('lic-client').value = '';
      addAuditLog('admin', `Lisensi baru dibuat: ${code} untuk ${client} (Limit: ${quota} seat).`);
    }
  })
  .catch(err => console.error(err));
}

function renderLicensesTable() {
  fetch('/api/admin/licenses')
  .then(res => res.json())
  .then(lics => {
    state.licenses = lics;
    const tbody = document.querySelector('#licenses-table tbody');
    tbody.innerHTML = '';
    
    lics.forEach(lic => {
      const row = `
        <tr>
          <td><strong>${lic.code}</strong></td>
          <td>${lic.client}</td>
          <td>${lic.quota} Seats</td>
          <td>${lic.used} Terdaftar</td>
          <td><span class="badge badge-green">${lic.status}</span></td>
          <td>
            <button class="btn btn-red-outline btn-xs" onclick="deleteLicenseKey('${lic.code}')"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', row);
    });
  })
  .catch(err => console.error(err));
}

function deleteLicenseKey(code) {
  if (confirm(`Apakah Anda yakin ingin memblokir/menghapus lisensi ${code}?`)) {
    fetch('/api/admin/license/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        showToast(`Lisensi ${code} dinonaktifkan.`);
        renderLicensesTable();
        addAuditLog('admin', `Lisensi resmi dihapus dari sistem: ${code}`);
      }
    })
    .catch(err => console.error(err));
  }
}

// Tab 3: Logs & leads
function renderLeadsTable() {
  fetch('/api/admin/leads')
  .then(res => res.json())
  .then(leads => {
    state.leads = leads;
    const tbody = document.querySelector('#leads-table tbody');
    tbody.innerHTML = '';
    
    leads.forEach(l => {
      const row = `
        <tr>
          <td><strong>${l.name}</strong></td>
          <td>${l.interest}</td>
          <td>${l.contact}</td>
          <td>${l.date}</td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', row);
    });
  })
  .catch(err => console.error(err));
}

function updateLogsUI() {
  const container = document.getElementById('system-logs-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  state.logs.forEach(entry => {
    const logHtml = `
      <div class="log-entry">
        <span class="log-time">[${entry.time}]</span>
        <span class="log-type ${entry.type === 'admin' ? 'log-err' : ''}">(${entry.type.toUpperCase()})</span>
        <span class="log-msg">${entry.msg}</span>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', logHtml);
  });
}

// ================= SPATIAL SQL CONSOLE ENGINE =================

function initSQLPreviewMap() {
  if (sqlPreviewMap) {
    sqlPreviewMap.invalidateSize();
    return;
  }
  
  sqlPreviewMap = L.map('sql-preview-map', { zoomControl: false }).setView([-6.2088, 106.8456], 12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB'
  }).addTo(sqlPreviewMap);
}

// SQL query template inserter
function insertSQLTemplate(type) {
  const editor = document.getElementById('sql-query-editor');
  
  if (type === 'select_points') {
    editor.value = `-- Kueri memilah titik survei RTK
SELECT 
    id, 
    name, 
    solution,
    elevation,
    latitude,
    longitude
FROM survey_points
WHERE solution = 'Fix';`;
  } else if (type === 'intersects') {
    editor.value = `-- Memilah Titik RTK
SELECT 
    id,
    name, 
    solution,
    elevation
FROM survey_points;`;
  } else if (type === 'distance') {
    editor.value = `-- Menghitung jarak horizontal antara titik survei RTK
SELECT 
    id,
    name, 
    solution
FROM survey_points LIMIT 10;`;
  }
}

// SQL Engine evaluator using MySQL Backend Execution
function executeSQLQuery() {
  const query = document.getElementById('sql-query-editor').value.trim();
  const startTime = performance.now();
  
  const resultTable = document.getElementById('sql-result-table');
  const resultMeta = document.getElementById('sql-result-meta');
  
  // Clean overlays on maps
  mapLayers.sql_visualizer.clearLayers();
  
  fetch('/api/admin/sql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })
  .then(res => res.json())
  .then(data => {
    const duration = ((performance.now() - startTime) / 1000).toFixed(3);
    if (data.success) {
      renderSQLResults(data.columns, data.rows);
      resultMeta.textContent = `${data.rows.length} Baris Terpilih (${duration}s)`;
      
      // Auto-detect geometry column inside rows
      data.rows.forEach(row => {
        // Look for geometry columns to render on preview map
        let ptName = row['name'] || row['id'] || 'Titik SQL';
        if (row['latitude'] !== undefined && row['longitude'] !== undefined) {
          const lat = parseFloat(row['latitude']);
          const lng = parseFloat(row['longitude']);
          if (!isNaN(lat) && !isNaN(lng)) {
            visualizeSQLGeometryOnMaps({
              type: "Point",
              coordinates: [lng, lat]
            }, ptName);
          }
        }
      });
      showToast('SQL Query sukses dieksekusi.');
      addAuditLog('admin', 'Menjalankan kueri SQL spasial kustom di MySQL.');
    } else {
      resultMeta.textContent = "Error!";
      resultTable.innerHTML = `<thead><tr><th class="log-err">SQL Exec Exception</th></tr></thead><tbody><tr><td class="log-err">${data.message}</td></tr></tbody>`;
      showToast('Query error: ' + data.message, true);
    }
  })
  .catch(err => {
    resultMeta.textContent = "Error!";
    resultTable.innerHTML = `<thead><tr><th class="log-err">Koneksi Putus</th></tr></thead><tbody><tr><td class="log-err">${err.message}</td></tr></tbody>`;
    showToast('Koneksi SQL gagal: ' + err.message, true);
  });
}

function renderSQLResults(cols, rows) {
  const table = document.getElementById('sql-result-table');
  table.innerHTML = '';
  
  // Render Headings
  let thead = '<thead><tr>';
  cols.forEach(c => {
    thead += `<th>${c}</th>`;
  });
  thead += '</tr></thead>';
  table.insertAdjacentHTML('beforeend', thead);
  
  // Render Rows
  let tbody = '<tbody>';
  if (rows.length === 0) {
    tbody += `<tr><td colspan="${cols.length}">Tidak ada baris yang memenuhi kondisi kueri.</td></tr>`;
  } else {
    rows.forEach(r => {
      tbody += '<tr>';
      cols.forEach(c => {
        tbody += `<td>${r[c] !== undefined && r[c] !== null ? r[c] : ''}</td>`;
      });
      tbody += '</tr>';
    });
  }
  tbody += '</tbody>';
  table.insertAdjacentHTML('beforeend', tbody);
}

function visualizeSQLGeometryOnMaps(geometry, label) {
  // Render on preview map and center
  const geomLayer = L.geoJSON(geometry, {
    style: { color: '#8b5cf6', weight: 4, fillColor: '#8b5cf6', fillOpacity: 0.6 },
    pointToLayer: function(feature, latlng) {
      return L.circleMarker(latlng, {
        radius: 8,
        fillColor: '#8b5cf6',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      });
    }
  });
  
  geomLayer.bindTooltip(label, { permanent: false, direction: 'top' });
  geomLayer.addTo(mapLayers.sql_visualizer);
  
  // Fit preview map bounds to visualize
  try {
    sqlPreviewMap.fitBounds(geomLayer.getBounds(), { maxZoom: 15 });
  } catch (e) {
    // Single point center fallback
    if (geometry.type === 'Point') {
      sqlPreviewMap.setView([geometry.coordinates[1], geometry.coordinates[0]], 15);
    }
  }
}
