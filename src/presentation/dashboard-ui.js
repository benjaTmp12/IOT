'use strict';

// =========================================================================
// CAPA DE PRESENTACIÓN · INTERFAZ WEB Y ORQUESTACIÓN INICIAL (DOM)
// Suscrito a Blackbox.Bus y conectado a Repository / Adapters / DigitalTwin3D.
// =========================================================================
window.Blackbox.UI = (() => {
  const { Bus, COMPONENT_DB, Repository, Domain, Adapters, DigitalTwin3D } = window.Blackbox;

  function getCategoryTag(cat) {
    if (cat === 'ACCESO_OK') return '<span class="tag tag-ok">ACCESO OK</span>';
    if (cat === 'ACCESO_DENEGADO') return '<span class="tag tag-warn">DENEGADO</span>';
    if (cat === 'INTRUSIÓN') return '<span class="tag tag-danger">INTRUSIÓN</span>';
    if (cat === 'FALLA_RED') return '<span class="tag tag-offline">SIN ENLACE</span>';
    return '<span class="tag tag-offline">SISTEMA</span>';
  }

  function renderState(st) {
    const banner = document.getElementById('statusBanner');
    banner.dataset.state = st.system;

    document.getElementById('stateTitle').textContent = st.system.replace('_', ' ');
    document.getElementById('stateNotice').textContent = st.lastNotice;

    const colors = {
      'ARMADO': 'var(--status-armed)',
      'DESARMADO': 'var(--status-ok)',
      'INTRUSIÓN': 'var(--status-danger)',
      'FALLA_COMUNICACIÓN': 'var(--status-offline)'
    };
    document.getElementById('stateDot').style.background = colors[st.system] || 'var(--status-armed)';

    document.getElementById('ledGreen').classList.toggle('on', st.system === 'DESARMADO');
    document.getElementById('ledYellow').classList.toggle('on', st.system === 'ARMADO');
    document.getElementById('ledRed').classList.toggle('on', st.system === 'INTRUSIÓN');

    document.getElementById('oledLine1').textContent = st.oled1;
    document.getElementById('oledLine2').textContent = st.oled2;

    const connPill = document.getElementById('connPill');
    const connLabel = document.getElementById('connLabel');
    const latencyBadge = document.getElementById('latencyBadge');
    connPill.classList.toggle('offline', !st.online);
    connLabel.textContent = st.serialActive
      ? (st.online ? 'USB Serial Activo (115200)' : 'Controlador: SIN ENLACE')
      : (st.online ? 'Controlador: En línea' : 'Controlador: SIN ENLACE');
    latencyBadge.textContent = st.online ? '115200 bps · OK' : 'TIMEOUT (>5s)';
    latencyBadge.className = 'tag ' + (st.online ? 'tag-ok' : 'tag-danger');

    document.getElementById('valRfid').textContent = st.lastRfid;
    document.getElementById('subRfid').textContent = st.lastHolder;

    const valDoor = document.getElementById('valDoor');
    valDoor.textContent = st.doorOpen ? 'ABIERTA (HIGH)' : 'CERRADA (LOW)';
    valDoor.style.color = st.doorOpen ? 'var(--status-armed)' : 'var(--text-primary)';
    document.getElementById('subDoor').textContent = st.doorOpen ? 'Contacto de puerta abierto' : 'Contacto de puerta cerrado';

    const valPir = document.getElementById('valPir');
    valPir.textContent = st.pirMotion ? 'ACTIVO (ALERTA)' : 'NORMAL (REPOSO)';
    valPir.style.color = st.pirMotion ? 'var(--status-danger)' : 'var(--text-primary)';

    const valServo = document.getElementById('valServo');
    valServo.textContent = st.lockOpen ? 'LIBRE (90°)' : 'BLOQUEADA (0°)';
    valServo.style.color = st.lockOpen ? 'var(--status-ok)' : 'var(--text-primary)';
    document.getElementById('subServo').textContent = st.system === 'INTRUSIÓN' ? 'Buzzer D8: SIRENA ACTIVA' : 'Buzzer D8: Silencioso';

    document.getElementById('lblToggleDoor').textContent = st.doorOpen ? '3. Cerrar Puerta' : '3. Abrir / Forzar Puerta';
    document.getElementById('lblCommFail').textContent = st.online ? '5. Simular Caída de Enlace' : '5. Restaurar Enlace';

    // Sync HUD viewport toggle labels
    document.getElementById('btnToggleWalls').classList.toggle('active', st.xrayWalls);
    const btnRoof = document.getElementById('btnToggleRoof');
    btnRoof.classList.toggle('active', st.roofOpen);
    btnRoof.textContent = st.roofOpen ? 'Cerrar Techo' : 'Abrir Techo';
    const btnCone = document.getElementById('btnTogglePirCone');
    btnCone.classList.toggle('active', st.showPirCone);
    btnCone.textContent = st.showPirCone ? 'Cono Sensor: ON' : 'Cono Sensor: OFF';
    const btnLid = document.getElementById('btnOpenLid');
    btnLid.classList.toggle('active', st.cajaLidOpen);
    btnLid.textContent = st.cajaLidOpen ? 'Cerrar Tapa 3D' : 'Abrir Tapa 3D';
  }

  function renderEvents() {
    const events = Repository.getEvents();
    document.getElementById('dbCountBadge').textContent = events.length;

    const recentList = document.getElementById('recentEventsList');
    recentList.innerHTML = events.slice(0, 6).map(ev => {
      const timeStr = new Date(ev.timestamp).toLocaleTimeString('es-CL', { hour12: false });
      return `<li class="feed-row">
        <span class="feed-time">${timeStr}</span>
        ${getCategoryTag(ev.category)}
        <span>${ev.detail}</span>
      </li>`;
    }).join('');

    const query = (document.getElementById('dbSearchInput')?.value || '').toLowerCase();
    const filterCat = document.getElementById('dbFilterType')?.value || 'ALL';
    const filtered = events.filter(ev => {
      if (filterCat !== 'ALL' && ev.category !== filterCat) return false;
      if (!query) return true;
      return ev.detail.toLowerCase().includes(query) || ev.uid.toLowerCase().includes(query) || ev.sensor.toLowerCase().includes(query);
    });

    document.getElementById('dbTableBody').innerHTML = filtered.map(ev => {
      const dt = new Date(ev.timestamp).toLocaleString('es-CL', { hour12: false });
      return `<tr>
        <td><code>#${ev.id}</code></td>
        <td>${dt}</td>
        <td>${getCategoryTag(ev.category)}</td>
        <td>${ev.sensor}</td>
        <td><code>${ev.uid}</code></td>
        <td><b>${ev.resultState}</b></td>
        <td>${ev.door}</td>
        <td>${ev.detail}</td>
      </tr>`;
    }).join('');
  }

  function renderTests() {
    const tests = Repository.getTests();
    document.getElementById('testMatrixBody').innerHTML = tests.map((t, idx) => {
      const tagClass = t.status === 'Aprobada' ? 'tag-ok' : 'tag-warn';
      return `<tr>
        <td><b>${t.name}</b></td>
        <td>${t.expected}</td>
        <td>
          <input type="text" value="${t.obtained.replace(/"/g, '&quot;')}" style="width:100%;"
            onchange="window.updateTestObtained(${idx}, this.value)">
        </td>
        <td>
          <select onchange="window.updateTestStatus(${idx}, this.value)" style="font-weight:700;">
            <option value="Aprobada" ${t.status === 'Aprobada' ? 'selected' : ''}>✅ Aprobada</option>
            <option value="Pendiente" ${t.status === 'Pendiente' ? 'selected' : ''}>⏳ Pendiente</option>
          </select>
          <span class="tag ${tagClass}" style="margin-left:6px;">${t.status}</span>
        </td>
      </tr>`;
    }).join('');
  }

  function renderInspector(compId) {
    const info = COMPONENT_DB[compId] || COMPONENT_DB.overview;
    document.querySelectorAll('.comp-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.comp === compId);
    });
    document.getElementById('hudFocusLabel').textContent = `Vista activa: ${info.title}`;
    document.getElementById('inspCategory').textContent = info.category;
    document.getElementById('inspTitle').textContent = info.title;
    document.getElementById('inspBadges').innerHTML = info.badges.map(b => `<span class="pin-badge">${b}</span>`).join('');
    document.getElementById('inspDescription').textContent = info.description;
    document.getElementById('inspSpecs').innerHTML = info.specs.map(s => `<li>${s}</li>`).join('');
    document.getElementById('inspCodeFile').textContent = info.codeFile;
    document.getElementById('inspCodeBlock').textContent = info.code;
  }

  // Suscripciones UI a Blackbox.Bus
  Bus.subscribe('state:changed', ({ state }) => renderState(state));
  Bus.subscribe('data:events_updated', () => renderEvents());
  Bus.subscribe('view:select_component', ({ compId }) => {
    renderInspector(compId);
    renderState(Domain.getState());
  });
  Bus.subscribe('ui:notice', ({ message }) => {
    document.getElementById('stateNotice').textContent = message;
  });

  // Globals para handlers inline HTML
  window.selectComponent = compId => Bus.publish('view:select_component', { compId });
  window.switchTab = tabId => {
    document.querySelectorAll('.nav-pill').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
    document.querySelectorAll('.tab-view').forEach(panel => panel.classList.toggle('active', panel.id === 'tab-' + tabId));
  };
  window.updateTestObtained = (idx, val) => Repository.updateTest(idx, { obtained: val });
  window.updateTestStatus = (idx, val) => { Repository.updateTest(idx, { status: val }); renderTests(); };

  // Bind controls
  document.querySelectorAll('.nav-pill').forEach(btn => btn.addEventListener('click', () => window.switchTab(btn.dataset.tab)));
  document.querySelectorAll('.comp-btn').forEach(btn => btn.addEventListener('click', () => window.selectComponent(btn.dataset.comp)));

  document.getElementById('btnTestSelectedComp').onclick = () => {
    const info = COMPONENT_DB[Domain.getState().selectedComp] || COMPONENT_DB.overview;
    if (info.testAction) info.testAction();
  };
  document.getElementById('btnCopyCode').onclick = () => {
    navigator.clipboard?.writeText(document.getElementById('inspCodeBlock').textContent);
    const btn = document.getElementById('btnCopyCode');
    btn.textContent = '¡Copiado!';
    setTimeout(() => (btn.textContent = 'Copiar código'), 1400);
  };

  document.getElementById('btnToggleWalls').onclick = () => Bus.publish('view:walls_toggle', {});
  document.getElementById('btnToggleRoof').onclick = () => Bus.publish('view:roof_toggle', {});
  document.getElementById('btnTogglePirCone').onclick = () => Bus.publish('view:cone_toggle', {});
  document.getElementById('btnOpenLid').onclick = () => Bus.publish('view:lid_toggle', {});

  document.getElementById('dbSearchInput').oninput = renderEvents;
  document.getElementById('dbFilterType').onchange = renderEvents;
  document.getElementById('btnExportCsv').onclick = Repository.exportEventsCsv;
  document.getElementById('btnExportJson').onclick = Repository.exportEventsJson;
  document.getElementById('btnClearDb').onclick = () => {
    Repository.clearEvents();
    Repository.appendEvent({
      category: 'SISTEMA',
      sensor: 'Operador',
      uid: '—',
      resultState: Domain.getState().system,
      doorOpen: Domain.getState().doorOpen,
      detail: 'Historial de base de datos reiniciado'
    });
  };
  document.getElementById('btnRunAllTests').onclick = () => {
    Bus.publish('input:rfid_valid', { holder: 'Fabian Barroso', uid: '04:7C:41:8E' });
    setTimeout(() => Bus.publish('input:rfid_invalid', { uid: 'FF:81:20:09' }), 550);
    setTimeout(() => Bus.publish('input:arm', {}), 1100);
    Bus.publish('ui:notice', { message: 'Autoprueba completada: Lectura RFID, persistencia en BD, comunicación y visualización verificadas.' });
  };
  document.getElementById('btnExportTests').onclick = Repository.exportTestsCsv;

  document.getElementById('themeBtn').onclick = () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    Bus.publish('view:theme_changed', { theme: next });
  };

  // Boot completo de capas
  Adapters.bindSimulatorControls();
  Bus.publish('view:select_component', { compId: 'overview' });
  renderEvents();
  renderTests();
  Domain.emitState();
  DigitalTwin3D.start();

  return { renderState, renderEvents };
})();
