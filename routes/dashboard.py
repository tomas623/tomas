"""
Dashboard del cliente: marcas registradas, historial de consultas, vigilancia.

Todas las rutas requieren login. La página /dashboard renderiza un SPA simple
con tabs (Alpine.js + fetch) y los datos vienen por API JSON.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime

from flask import Blueprint, jsonify, render_template_string, request

from database import (
    AlertaVigilancia, Consulta, MarcaCliente, Pago,
    SuscripcionVigilancia, get_session,
)
from services.auth import current_user, has_active_premium, login_required, premium_required

logger = logging.getLogger(__name__)
bp = Blueprint("dashboard", __name__)

PRECIO_VIGILANCIA_MARCA = float(os.getenv("PRECIO_VIGILANCIA_MARCA", "20000"))
PRECIO_VIGILANCIA_PORTFOLIO = float(os.getenv("PRECIO_VIGILANCIA_PORTFOLIO", "50000"))


def _ok(data, status=200):
    return jsonify({"ok": True, "data": data}), status


def _err(msg, status=400):
    return jsonify({"ok": False, "error": msg}), status


# ─────────────────────────────────────────────────────────────────────
# Página HTML del dashboard (Alpine.js)
# ─────────────────────────────────────────────────────────────────────

DASHBOARD_PAGE = """<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mi panel — LegalPacers</title>
<script defer src="https://unpkg.com/alpinejs@3.13.0/dist/cdn.min.js"></script>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#F4F5F9;color:#0D1B4B}
  .nav{background:#fff;border-bottom:1px solid #E2E8F0;padding:14px 32px;
       display:flex;align-items:center;justify-content:space-between}
  .logo{font-weight:800;font-size:18px;letter-spacing:.5px}
  .logo .accent{color:#1B6EF3}
  .user{font-size:14px;color:#64748b}
  .user a{color:#DC2626;margin-left:12px;text-decoration:none}
  main{max-width:1100px;margin:32px auto;padding:0 24px}
  h1{margin:0 0 24px}
  .tabs{display:flex;gap:0;background:#fff;border-radius:10px;padding:4px;margin-bottom:24px;
        box-shadow:0 1px 3px rgba(0,0,0,.05);max-width:fit-content}
  .tab{padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:600;font-size:14px;
       color:#64748b;transition:.15s}
  .tab.active{background:#1B6EF3;color:#fff}
  .card{background:#fff;border-radius:12px;padding:24px;margin-bottom:16px;
        box-shadow:0 1px 4px rgba(0,0,0,.05)}
  .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600}
  .badge.green{background:#DCFCE7;color:#16A34A}
  .badge.yellow{background:#FEF9C3;color:#B45309}
  .badge.red{background:#FEE2E2;color:#DC2626}
  .badge.gray{background:#E5E7EB;color:#374151}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  table td,table th{padding:10px;text-align:left;border-bottom:1px solid #E2E8F0}
  table th{font-size:12px;color:#64748b;text-transform:uppercase;font-weight:600}
  button{padding:10px 18px;background:#1B6EF3;color:#fff;border:none;border-radius:8px;
         font-weight:600;cursor:pointer;font-size:14px}
  button:hover{background:#1656c4}
  button.sec{background:#fff;color:#1B6EF3;border:1px solid #1B6EF3}
  button.danger{background:#DC2626}
  button.small{padding:6px 12px;font-size:13px}
  input,select{padding:10px;border:1px solid #E2E8F0;border-radius:8px;font-size:14px;
               width:100%;font-family:inherit}
  label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px;color:#0D1B4B}
  .empty{text-align:center;padding:40px;color:#64748b}
  .alert-row{padding:14px;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
  .alert-row.alto{background:#FEE2E2}
  .alert-row.medio{background:#FEF9C3}
  .alert-row.bajo{background:#DBEAFE}
  .modal{position:fixed;inset:0;background:rgba(13,27,75,.4);display:flex;align-items:center;
         justify-content:center;z-index:50;padding:20px}
  .modal-content{background:#fff;border-radius:12px;padding:28px;max-width:480px;width:100%}
</style></head>
<body x-data="dashboard()" x-init="cargar()">

<div class="nav">
  <div class="logo">LEGAL<span class="accent">PACERS</span> · Mi panel</div>
  <div class="user">
    <span x-text="user.email"></span>
    <a href="/logout">Cerrar sesión</a>
  </div>
</div>

<main>
  <h1>Hola<span x-show="user.nombre" x-text="', ' + user.nombre"></span> 👋</h1>

  <div class="tabs">
    <div class="tab" :class="tab==='consultas'&&'active'" @click="tab='consultas'">Consultas</div>
    <div class="tab" :class="tab==='marcas'&&'active'" @click="tab='marcas'">Mis marcas</div>
    <div class="tab" :class="tab==='vigilancia'&&'active'" @click="tab='vigilancia'">Vigilancia</div>
    <div class="tab" :class="tab==='alertas'&&'active'" @click="tab='alertas'">Alertas</div>
    <div class="tab" :class="tab==='pagos'&&'active'" @click="tab='pagos'">Pagos</div>
  </div>

  <!-- CONSULTAS -->
  <div x-show="tab==='consultas'" class="card">
    <h3 style="margin-top:0">Historial de consultas</h3>
    <p x-show="!consultas.length" class="empty">Todavía no hiciste ninguna consulta. <a href="/">Buscar una marca →</a></p>
    <table x-show="consultas.length">
      <thead><tr><th>Marca</th><th>Nivel</th><th>Diagnóstico</th><th>Fecha</th><th></th></tr></thead>
      <tbody>
        <template x-for="c in consultas" :key="c.id">
          <tr>
            <td><strong x-text="c.marca"></strong></td>
            <td><span class="badge" :class="c.nivel==='completa'?'green':'gray'" x-text="c.nivel"></span></td>
            <td>
              <span class="badge" :class="diagBadge(c.diagnostico)" x-text="c.diagnostico||'pendiente'"></span>
            </td>
            <td x-text="fmtDate(c.created_at)"></td>
            <td><a :href="'/marca/consulta/'+c.id" style="color:#1B6EF3">Ver →</a></td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>

  <!-- MIS MARCAS -->
  <div x-show="tab==='marcas'" class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">Mis marcas</h3>
      <div style="display:flex;gap:8px">
        <button class="small sec" @click="modalBulk=true">Cargar desde Excel</button>
        <button class="small" @click="modalMarca=true">+ Agregar marca</button>
      </div>
    </div>
    <p style="color:#64748b;font-size:14px;margin-top:0">
      Cargá las marcas que tenés registradas, en trámite o de terceros que te interesa seguir.
      Te avisamos las fechas clave: oposición (90 días desde la publicación),
      <strong>DJU</strong> a los 5 años y <strong>renovación</strong> a los 10.
    </p>
    <p x-show="!marcas.length" class="empty">Todavía no cargaste ninguna marca. Tocá "Agregar marca" o "Cargar desde Excel".</p>
    <div x-show="marcas.length" style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Marca</th><th>Clase</th><th>Tipo</th><th>Estado</th>
        <th>Oposición vence</th><th>DJU (5 años)</th><th>Vence (10 años)</th><th></th>
      </tr></thead>
      <tbody>
        <template x-for="m in marcas" :key="m.id">
          <tr>
            <td><strong x-text="m.denominacion"></strong>
              <div style="font-size:12px;color:#64748b">
                <span x-show="m.acta">Acta <span x-text="m.acta"></span></span>
                <span x-show="!m.es_propia && m.titular"> · titular: <span x-text="m.titular"></span></span>
              </div>
            </td>
            <td x-text="m.clase || '—'"></td>
            <td>
              <span class="badge" :class="m.es_propia ? 'green' : 'gray'"
                    x-text="m.es_propia ? 'Propia' : 'Tercero'"></span>
            </td>
            <td><span class="badge gray" x-text="m.estado||'—'"></span></td>
            <td>
              <span x-text="fmtDate(m.fecha_oposicion_fin)"></span>
              <span class="badge" :class="hitoBadge(m.fecha_oposicion_fin)"
                    x-show="m.fecha_oposicion_fin" x-text="hitoLabel(m.fecha_oposicion_fin)"></span>
            </td>
            <td>
              <span x-text="fmtDate(m.fecha_dju)"></span>
              <span class="badge" :class="hitoBadge(m.fecha_dju)"
                    x-show="m.fecha_dju" x-text="hitoLabel(m.fecha_dju)"></span>
            </td>
            <td>
              <span x-text="fmtDate(m.fecha_vencimiento)"></span>
              <span class="badge" :class="hitoBadge(m.fecha_vencimiento)"
                    x-show="m.fecha_vencimiento" x-text="hitoLabel(m.fecha_vencimiento)"></span>
            </td>
            <td>
              <button class="small sec" x-show="!hasVigilancia(m.id)"
                      @click="iniciarVigilancia(m.id)">Activar vigilancia</button>
              <span class="badge green" x-show="hasVigilancia(m.id)">Vigilando</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    </div>
  </div>

  <!-- VIGILANCIA -->
  <div x-show="tab==='vigilancia'" class="card">
    <h3 style="margin-top:0">Suscripciones de vigilancia</h3>
    <p style="color:#64748b">
      Cada semana, cuando el INPI publica su boletín, escaneamos automáticamente
      las marcas nuevas y te alertamos por email y en este panel si alguna se parece a las tuyas.
      Tu plan <strong>Premium</strong> incluye <strong>3 vigilancias activas</strong>;
      las adicionales son $<span x-text="precios.vigilancia_marca.toLocaleString('es-AR')"></span> ARS / mes cada una.
    </p>
    <p x-show="!vigilancia.length" class="empty">
      Aún no tenés vigilancia activa. Andá a <a href="#" @click.prevent="tab='marcas'">Mis marcas</a> y activala desde una marca cargada.
    </p>
    <table x-show="vigilancia.length">
      <thead><tr><th>Marca vigilada</th><th>Tipo</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        <template x-for="v in vigilancia" :key="v.id">
          <tr>
            <td x-text="v.marca_nombre || '(portfolio)'"></td>
            <td>
              <span x-text="v.tipo"></span>
              <span class="badge green" x-show="v.monto === 0">Incluida en Premium</span>
            </td>
            <td><span x-show="v.monto > 0">$<span x-text="v.monto.toLocaleString('es-AR')"></span></span>
                <span x-show="v.monto === 0" style="color:#16A34A">$0</span></td>
            <td>
              <span class="badge" :class="v.status==='active'?'green':'gray'" x-text="v.status"></span>
            </td>
            <td>
              <button class="small danger" x-show="v.status==='active'"
                      @click="cancelarVigilancia(v.id)">Cancelar</button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>

  <!-- ALERTAS -->
  <div x-show="tab==='alertas'" class="card">
    <h3 style="margin-top:0">Alertas detectadas</h3>
    <p x-show="!alertas.length" class="empty">No hay alertas. Si activás vigilancia, te avisamos acá y por email.</p>
    <template x-for="a in alertas" :key="a.id">
      <div class="alert-row" :class="a.nivel">
        <div>
          <strong x-text="a.marca_nueva_denominacion"></strong>
          <span style="color:#64748b;font-size:13px">— similar a tu marca <strong x-text="a.marca_propia"></strong></span>
          <div style="font-size:13px;margin-top:4px">
            Clase <span x-text="a.marca_nueva_clase"></span> ·
            Titular: <span x-text="a.marca_nueva_titular"></span> ·
            Score: <strong x-text="(a.score*100).toFixed(0)+'%'"></strong>
          </div>
        </div>
        <span class="badge" :class="a.nivel==='alto'?'red':a.nivel==='medio'?'yellow':'gray'"
              x-text="a.nivel" style="text-transform:uppercase"></span>
      </div>
    </template>
  </div>

  <!-- PAGOS -->
  <div x-show="tab==='pagos'" class="card">
    <h3 style="margin-top:0">Historial de pagos</h3>
    <p x-show="!pagos.length" class="empty">No hay pagos registrados todavía.</p>
    <table x-show="pagos.length">
      <thead><tr><th>Concepto</th><th>Monto</th><th>Estado</th><th>Fecha</th></tr></thead>
      <tbody>
        <template x-for="p in pagos" :key="p.id">
          <tr>
            <td x-text="p.tipo"></td>
            <td>$<span x-text="p.monto.toLocaleString('es-AR')"></span></td>
            <td><span class="badge" :class="p.status==='approved'?'green':p.status==='pending'?'yellow':'gray'" x-text="p.status"></span></td>
            <td x-text="fmtDate(p.created_at)"></td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>

  <!-- MODAL agregar marca -->
  <div class="modal" x-show="modalMarca" x-cloak @click.self="modalMarca=false">
    <div class="modal-content" style="max-width:560px">
      <h3 style="margin-top:0">Agregar marca</h3>

      <label>Denominación *</label>
      <input type="text" x-model="nueva.denominacion" placeholder="Mi Marca">

      <label>Tipo</label>
      <select x-model="nueva.es_propia">
        <option :value="true">Propia (la tengo o la voy a registrar)</option>
        <option :value="false">De tercero (la quiero monitorear)</option>
      </select>

      <label x-show="!nueva.es_propia">Titular (de quién es)</label>
      <input x-show="!nueva.es_propia" type="text" x-model="nueva.titular"
             placeholder="Ej: Acme S.A.">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label>Clase Niza</label>
          <input type="number" x-model.number="nueva.clase" min="1" max="45" placeholder="ej: 25">
        </div>
        <div>
          <label>Acta INPI (opcional)</label>
          <input type="text" x-model="nueva.acta">
        </div>
      </div>

      <label>Estado (opcional)</label>
      <select x-model="nueva.estado">
        <option value="">—</option>
        <option value="solicitada">Solicitada (en trámite)</option>
        <option value="publicada">Publicada en boletín</option>
        <option value="oposicion">Con oposición</option>
        <option value="concedida">Concedida / Registrada</option>
        <option value="vencida">Vencida</option>
      </select>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label>Inicio de trámite</label>
          <input type="date" x-model="nueva.fecha_solicitud">
        </div>
        <div>
          <label>Fecha de publicación</label>
          <input type="date" x-model="nueva.fecha_publicacion">
          <p style="font-size:11px;color:#64748b;margin:2px 0 0">Para contar los 90 días de oposición.</p>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label>Fecha de oposición</label>
          <input type="date" x-model="nueva.fecha_oposicion">
          <p style="font-size:11px;color:#64748b;margin:2px 0 0">Si hubo oposición.</p>
        </div>
        <div>
          <label>Fecha de concesión</label>
          <input type="date" x-model="nueva.fecha_concesion">
          <p style="font-size:11px;color:#64748b;margin:2px 0 0">Si la cargás, calculamos DJU y vencimiento.</p>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="sec" @click="modalMarca=false" style="flex:1">Cancelar</button>
        <button @click="guardarMarca()" style="flex:1">Guardar</button>
      </div>
    </div>
  </div>

  <!-- MODAL carga masiva (Excel/CSV) -->
  <div class="modal" x-show="modalBulk" x-cloak @click.self="modalBulk=false">
    <div class="modal-content" style="max-width:520px">
      <h3 style="margin-top:0">Cargar marcas desde Excel</h3>
      <p style="color:#475569;font-size:14px;margin-top:0">
        Subí un .xlsx o .csv con una fila por marca. La primera fila tiene que tener los nombres de las columnas.
      </p>
      <p style="font-size:13px;color:#64748b">
        <strong>Columnas reconocidas:</strong>
        denominacion (obligatoria), clase, acta, titular, estado, es_propia (sí/no),
        fecha_solicitud, fecha_publicacion, fecha_oposicion,
        fecha_concesion, fecha_vencimiento, notas.
      </p>
      <input type="file" accept=".xlsx,.xlsm,.csv" @change="bulkFile = $event.target.files[0]">
      <div x-show="bulkResult" style="margin-top:14px;background:#F4F5F9;
                                       padding:12px;border-radius:8px;font-size:14px">
        <div><strong x-text="bulkResult?.creadas"></strong> marcas creadas.</div>
        <div x-show="bulkResult?.errores?.length" style="margin-top:8px">
          <strong>Errores:</strong>
          <ul style="margin:6px 0 0;padding-left:20px;color:#991B1B">
            <template x-for="e in (bulkResult?.errores || [])">
              <li><span x-text="'Fila ' + e.fila + ': ' + e.motivo"></span></li>
            </template>
          </ul>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="sec" @click="modalBulk=false; bulkFile=null; bulkResult=null" style="flex:1">Cerrar</button>
        <button @click="subirBulk()" :disabled="!bulkFile || bulkLoading" style="flex:1">
          <span x-show="!bulkLoading">Subir archivo</span>
          <span x-show="bulkLoading" x-cloak>Procesando…</span>
        </button>
      </div>
    </div>
  </div>

</main>

<script>
function dashboard(){
  return {
    tab: new URLSearchParams(location.search).get('tab') || 'consultas',
    user: {email:'', nombre:''},
    consultas: [], marcas: [], vigilancia: [], alertas: [], pagos: [],
    precios: {vigilancia_marca: 20000, vigilancia_portfolio: 50000},
    modalMarca: false,
    nueva: {
      denominacion:'', clase:null, acta:'', estado:'',
      es_propia: true, titular:'',
      fecha_solicitud:'', fecha_publicacion:'', fecha_oposicion:'', fecha_concesion:'',
    },
    modalBulk: false, bulkFile: null, bulkResult: null, bulkLoading: false,

    async cargar(){
      const me = await fetch('/api/auth/me').then(r=>r.json());
      if(!me.data.authenticated){ location.href='/login'; return; }
      this.user = me.data;
      await Promise.all([
        this.fetchConsultas(), this.fetchMarcas(),
        this.fetchVigilancia(), this.fetchAlertas(), this.fetchPagos(),
        this.fetchPrecios(),
      ]);
    },
    async fetchConsultas(){ this.consultas = (await fetch('/api/dashboard/consultas').then(r=>r.json())).data || []; },
    async fetchMarcas(){    this.marcas    = (await fetch('/api/dashboard/marcas').then(r=>r.json())).data || []; },
    async fetchVigilancia(){this.vigilancia= (await fetch('/api/dashboard/vigilancia').then(r=>r.json())).data || []; },
    async fetchAlertas(){   this.alertas   = (await fetch('/api/dashboard/alertas').then(r=>r.json())).data || []; },
    async fetchPagos(){     this.pagos     = (await fetch('/api/dashboard/pagos').then(r=>r.json())).data || []; },
    async fetchPrecios(){   this.precios   = (await fetch('/api/dashboard/precios').then(r=>r.json())).data || this.precios; },

    fmtDate(d){ return d ? new Date(d).toLocaleDateString('es-AR') : '—'; },
    diagBadge(d){ return ({
      'viable':'green','viable_con_ajustes':'yellow','riesgo_alto':'red',
    })[d] || 'gray'; },
    _daysTo(dateStr){
      if(!dateStr) return null;
      const target = new Date(dateStr);
      const now = new Date();
      return Math.floor((target - now) / (1000*60*60*24));
    },
    hitoBadge(dateStr){
      const d = this._daysTo(dateStr);
      if(d === null) return 'gray';
      if(d < 0) return 'red';
      if(d <= 30) return 'red';
      if(d <= 90) return 'yellow';
      return 'green';
    },
    hitoLabel(dateStr){
      const d = this._daysTo(dateStr);
      if(d === null) return '';
      if(d < 0) return 'vencido';
      if(d === 0) return 'hoy';
      if(d <= 30) return d + 'd';
      if(d <= 90) return d + 'd';
      if(d <= 365) return Math.round(d/30) + 'm';
      return Math.round(d/365) + 'a';
    },
    hasVigilancia(marcaId){
      return this.vigilancia.some(v => v.marca_cliente_id===marcaId && v.status==='active');
    },
    async guardarMarca(){
      const r = await fetch('/api/dashboard/marcas',{method:'POST',headers:{'Content-Type':'application/json'},
        body: JSON.stringify(this.nueva)}).then(r=>r.json());
      if(!r.ok){ alert(r.error||'Error'); return; }
      this.modalMarca=false;
      this.nueva = {
        denominacion:'', clase:null, acta:'', estado:'',
        es_propia: true, titular:'',
        fecha_solicitud:'', fecha_publicacion:'', fecha_oposicion:'', fecha_concesion:'',
      };
      await this.fetchMarcas();
    },

    async subirBulk(){
      if(!this.bulkFile) return;
      this.bulkLoading = true;
      this.bulkResult = null;
      try {
        const fd = new FormData();
        fd.append('file', this.bulkFile);
        const r = await fetch('/api/dashboard/marcas/bulk', {method:'POST', body: fd}).then(r=>r.json());
        if(!r.ok){ alert(r.error || 'Error'); return; }
        this.bulkResult = r.data;
        await this.fetchMarcas();
      } catch(e){
        alert('Error de red al subir el archivo.');
      } finally {
        this.bulkLoading = false;
      }
    },
    async iniciarVigilancia(marcaId){
      const r = await fetch('/api/dashboard/vigilancia/activar',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({marca_cliente_id: marcaId})}).then(r=>r.json());
      if(!r.ok){ alert(r.error||'Error'); return; }
      if(r.data.covered_by_premium){
        alert('Vigilancia activada (incluida en tu plan Premium).');
        await Promise.all([this.fetchVigilancia(), this.fetchMarcas()]);
        return;
      }
      if(r.data.init_point){ window.location.href = r.data.init_point; }
      else { await this.fetchVigilancia(); }
    },
    async cancelarVigilancia(id){
      if(!confirm('¿Cancelar la suscripción de vigilancia?')) return;
      const r = await fetch('/api/dashboard/vigilancia/'+id+'/cancelar',{method:'POST'}).then(r=>r.json());
      if(!r.ok){ alert(r.error||'Error'); return; }
      await this.fetchVigilancia();
    },
  };
}
</script>
</body></html>"""


@bp.route("/dashboard")
@premium_required
def dashboard_page():
    return render_template_string(DASHBOARD_PAGE)


# ─────────────────────────────────────────────────────────────────────
# API JSON del dashboard
# ─────────────────────────────────────────────────────────────────────

@bp.route("/api/dashboard/precios", methods=["GET"])
def api_precios():
    return _ok({
        "vigilancia_marca": PRECIO_VIGILANCIA_MARCA,
        "vigilancia_portfolio": PRECIO_VIGILANCIA_PORTFOLIO,
        "consulta_completa": float(os.getenv("PRECIO_CONSULTA_COMPLETA", "15000")),
    })


@bp.route("/api/dashboard/consultas", methods=["GET"])
@login_required
def api_consultas():
    user = current_user()
    with get_session() as s:
        rows = (s.query(Consulta)
                .filter((Consulta.user_id == user.id) | (Consulta.email == user.email))
                .order_by(Consulta.created_at.desc())
                .limit(100).all())
        return _ok([{
            "id": c.id, "marca": c.marca, "nivel": c.nivel,
            "diagnostico": c.diagnostico, "paid": c.paid,
            "created_at": c.created_at.isoformat(),
        } for c in rows])


@bp.route("/api/dashboard/marcas", methods=["GET"])
@login_required
def api_marcas_list():
    user = current_user()
    with get_session() as s:
        rows = s.query(MarcaCliente).filter_by(user_id=user.id).all()
        return _ok([_marca_payload(m) for m in rows])


def _marca_payload(m: "MarcaCliente") -> dict:
    """Serializa MarcaCliente y calcula DJU (5a) y fin del plazo de oposición (90d)."""
    fecha_dju = None
    if m.fecha_concesion:
        try:
            fecha_dju = m.fecha_concesion.replace(year=m.fecha_concesion.year + 5).isoformat()
        except ValueError:
            fecha_dju = m.fecha_concesion.replace(year=m.fecha_concesion.year + 5,
                                                  day=28).isoformat()

    fecha_oposicion_fin = None
    if m.fecha_publicacion:
        from datetime import timedelta as _td
        fecha_oposicion_fin = (m.fecha_publicacion + _td(days=90)).isoformat()

    return {
        "id": m.id, "denominacion": m.denominacion, "clase": m.clase,
        "acta": m.acta, "estado": m.estado, "titular": m.titular,
        "es_propia": bool(m.es_propia) if m.es_propia is not None else True,
        "fecha_solicitud": m.fecha_solicitud.isoformat() if m.fecha_solicitud else None,
        "fecha_publicacion": m.fecha_publicacion.isoformat() if m.fecha_publicacion else None,
        "fecha_oposicion": m.fecha_oposicion.isoformat() if m.fecha_oposicion else None,
        "fecha_oposicion_fin": fecha_oposicion_fin,
        "fecha_concesion": m.fecha_concesion.isoformat() if m.fecha_concesion else None,
        "fecha_vencimiento": m.fecha_vencimiento.isoformat() if m.fecha_vencimiento else None,
        "fecha_dju": fecha_dju,
    }


@bp.route("/api/dashboard/marcas", methods=["POST"])
@login_required
def api_marcas_add():
    user = current_user()
    data = request.get_json(silent=True) or {}
    deno = (data.get("denominacion") or "").strip()
    if not deno:
        return _err("Denominación requerida")

    def _parse_date(v):
        if not v:
            return None
        try:
            return datetime.fromisoformat(v).date()
        except Exception:
            return None

    fecha_solic = _parse_date(data.get("fecha_solicitud"))
    fecha_pub = _parse_date(data.get("fecha_publicacion"))
    fecha_opo = _parse_date(data.get("fecha_oposicion"))
    fecha_conc = _parse_date(data.get("fecha_concesion"))
    fecha_venc = _parse_date(data.get("fecha_vencimiento"))

    if fecha_conc and not fecha_venc:
        try:
            fecha_venc = fecha_conc.replace(year=fecha_conc.year + 10)
        except ValueError:
            fecha_venc = fecha_conc.replace(year=fecha_conc.year + 10, day=28)

    es_propia = data.get("es_propia")
    if es_propia is None:
        es_propia = True
    else:
        es_propia = bool(es_propia)

    with get_session() as s:
        m = MarcaCliente(
            user_id=user.id,
            denominacion=deno,
            clase=data.get("clase"),
            acta=(data.get("acta") or "").strip() or None,
            titular=(data.get("titular") or "").strip() or None,
            estado=(data.get("estado") or "").strip() or None,
            es_propia=es_propia,
            fecha_solicitud=fecha_solic,
            fecha_publicacion=fecha_pub,
            fecha_oposicion=fecha_opo,
            fecha_concesion=fecha_conc,
            fecha_vencimiento=fecha_venc,
            notas=(data.get("notas") or "").strip() or None,
        )
        s.add(m)
        s.commit()
        return _ok({"id": m.id}, 201)


@bp.route("/api/dashboard/marcas/bulk", methods=["POST"])
@login_required
def api_marcas_bulk():
    """Carga masiva de marcas vía Excel (.xlsx) o CSV.

    Columnas esperadas (case-insensitive, en cualquier orden):
      denominacion (obligatoria), clase, acta, titular, estado, es_propia,
      fecha_solicitud, fecha_publicacion, fecha_oposicion, fecha_concesion,
      fecha_vencimiento, notas

    Devuelve {creadas, errores: [{fila, motivo}]}.
    """
    user = current_user()
    f = request.files.get("file")
    if not f:
        return _err("Subí un archivo .xlsx o .csv")

    filename = (f.filename or "").lower()
    rows = []
    try:
        if filename.endswith(".csv"):
            import csv, io
            text = f.stream.read().decode("utf-8-sig", errors="replace")
            reader = csv.DictReader(io.StringIO(text))
            rows = [dict(r) for r in reader]
        elif filename.endswith(".xlsx") or filename.endswith(".xlsm"):
            from openpyxl import load_workbook
            wb = load_workbook(f.stream, read_only=True, data_only=True)
            ws = wb.active
            headers = None
            for r in ws.iter_rows(values_only=True):
                if not any(r):
                    continue
                if headers is None:
                    headers = [str(c).strip().lower() if c is not None else f"col{i}"
                               for i, c in enumerate(r)]
                    continue
                row = {headers[i]: r[i] for i in range(min(len(headers), len(r)))}
                rows.append(row)
        else:
            return _err("Formato no soportado. Usá .xlsx o .csv")
    except Exception as e:
        logger.exception("Error parseando bulk upload")
        return _err(f"No pudimos leer el archivo: {e}")

    if not rows:
        return _err("El archivo está vacío")

    def _to_date(v):
        if v is None or v == "":
            return None
        if isinstance(v, datetime):
            return v.date()
        if hasattr(v, "year") and hasattr(v, "month"):  # date
            return v
        try:
            return datetime.fromisoformat(str(v).strip()[:10]).date()
        except Exception:
            for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%m/%d/%Y"):
                try:
                    return datetime.strptime(str(v).strip(), fmt).date()
                except Exception:
                    continue
            return None

    def _to_bool_propia(v):
        if v is None or v == "":
            return True
        s = str(v).strip().lower()
        if s in ("no", "tercero", "false", "0", "n"):
            return False
        return True

    creadas = 0
    errores = []
    with get_session() as s:
        for idx, row in enumerate(rows, start=2):  # fila 1 = headers
            r = {(k or "").strip().lower(): v for k, v in row.items()}
            deno = (r.get("denominacion") or r.get("denominación") or r.get("marca") or "").strip() if isinstance(r.get("denominacion") or r.get("denominación") or r.get("marca"), str) else r.get("denominacion") or r.get("denominación") or r.get("marca")
            if not deno or not str(deno).strip():
                errores.append({"fila": idx, "motivo": "Falta denominación"})
                continue
            try:
                clase_raw = r.get("clase")
                clase_int = int(clase_raw) if clase_raw not in (None, "") else None
            except (ValueError, TypeError):
                clase_int = None
            try:
                m = MarcaCliente(
                    user_id=user.id,
                    denominacion=str(deno).strip()[:300],
                    clase=clase_int,
                    acta=(str(r.get("acta") or "").strip() or None),
                    titular=(str(r.get("titular") or "").strip() or None),
                    estado=(str(r.get("estado") or "").strip() or None),
                    es_propia=_to_bool_propia(r.get("es_propia") or r.get("propia")),
                    fecha_solicitud=_to_date(r.get("fecha_solicitud") or r.get("inicio")),
                    fecha_publicacion=_to_date(r.get("fecha_publicacion") or r.get("publicacion") or r.get("publicación")),
                    fecha_oposicion=_to_date(r.get("fecha_oposicion") or r.get("oposicion") or r.get("oposición")),
                    fecha_concesion=_to_date(r.get("fecha_concesion") or r.get("concesion") or r.get("concesión")),
                    fecha_vencimiento=_to_date(r.get("fecha_vencimiento") or r.get("vencimiento")),
                    notas=(str(r.get("notas") or "").strip() or None),
                )
                s.add(m)
                creadas += 1
            except Exception as e:
                errores.append({"fila": idx, "motivo": str(e)[:200]})
        s.commit()

    return _ok({"creadas": creadas, "errores": errores})


@bp.route("/api/dashboard/marcas/<int:marca_id>", methods=["DELETE"])
@login_required
def api_marcas_delete(marca_id: int):
    user = current_user()
    with get_session() as s:
        m = s.query(MarcaCliente).filter_by(id=marca_id, user_id=user.id).first()
        if not m:
            return _err("No encontrada", 404)
        s.delete(m)
        s.commit()
        return _ok({"deleted": True})


@bp.route("/api/dashboard/vigilancia", methods=["GET"])
@login_required
def api_vigilancia_list():
    user = current_user()
    with get_session() as s:
        rows = (s.query(SuscripcionVigilancia)
                .filter_by(user_id=user.id).order_by(SuscripcionVigilancia.activated_at.desc()).all())
        out = []
        for v in rows:
            marca_nombre = None
            if v.marca_cliente_id:
                mc = s.query(MarcaCliente).filter_by(id=v.marca_cliente_id).first()
                marca_nombre = mc.denominacion if mc else None
            out.append({
                "id": v.id,
                "marca_cliente_id": v.marca_cliente_id,
                "marca_nombre": marca_nombre,
                "tipo": v.tipo,
                "status": v.status,
                "monto": v.monto,
                "activated_at": v.activated_at.isoformat() if v.activated_at else None,
                "next_check_at": v.next_check_at.isoformat() if v.next_check_at else None,
            })
        return _ok(out)


PREMIUM_VIGILANCIA_CAP = 3


@bp.route("/api/dashboard/vigilancia/activar", methods=["POST"])
@login_required
def api_vigilancia_activar():
    user = current_user()
    data = request.get_json(silent=True) or {}
    marca_cliente_id = data.get("marca_cliente_id")
    tipo = data.get("tipo", "marca")  # 'marca' o 'portfolio'

    with get_session() as s:
        if tipo == "marca":
            if not marca_cliente_id:
                return _err("Seleccioná una marca para vigilar")
            mc = s.query(MarcaCliente).filter_by(
                id=marca_cliente_id, user_id=user.id).first()
            if not mc:
                return _err("Marca no encontrada", 404)
            descripcion = f"Vigilancia mensual de \"{mc.denominacion}\""
            monto = PRECIO_VIGILANCIA_MARCA
        else:
            descripcion = "Vigilancia mensual de portfolio (todas mis marcas)"
            monto = PRECIO_VIGILANCIA_PORTFOLIO

        # Evitar duplicados activos
        existing = (s.query(SuscripcionVigilancia)
                    .filter_by(user_id=user.id, marca_cliente_id=marca_cliente_id,
                               status="active").first())
        if existing:
            return _err("Ya tenés vigilancia activa sobre esa marca", 409)

        # ¿Premium activo? — entonces vigilancia gratis hasta el cap (3 marcas)
        premium = has_active_premium(user)
        vigiladas_count = (s.query(SuscripcionVigilancia)
                           .filter_by(user_id=user.id, status="active", tipo="marca")
                           .count())
        covered_by_premium = premium and vigiladas_count < PREMIUM_VIGILANCIA_CAP

        if covered_by_premium:
            # Activación inmediata, sin pasar por MP
            sub = SuscripcionVigilancia(
                user_id=user.id,
                marca_cliente_id=marca_cliente_id,
                tipo=tipo, status="active", monto=0.0,
                activated_at=datetime.utcnow(),
                metadata_json={"covered_by": "premium"},
            )
            s.add(sub)
            s.commit()
            s.refresh(sub)
            return _ok({
                "suscripcion_id": sub.id,
                "monto": 0.0,
                "covered_by_premium": True,
                "init_point": None,
            })

        if premium and vigiladas_count >= PREMIUM_VIGILANCIA_CAP:
            return _err(
                f"Tu plan Premium cubre {PREMIUM_VIGILANCIA_CAP} marcas. "
                "Cancelá una vigilancia existente o pagá esta como vigilancia individual.",
                402,
            )

        sub = SuscripcionVigilancia(
            user_id=user.id,
            marca_cliente_id=marca_cliente_id,
            tipo=tipo, status="pending", monto=monto,
        )
        s.add(sub)
        s.commit()
        s.refresh(sub)
        sub_id = sub.id

    from services.mercadopago import create_vigilancia_subscription
    pref = create_vigilancia_subscription(
        suscripcion_id=sub_id, email=user.email,
        monto=monto, descripcion=descripcion,
    )

    return _ok({
        "suscripcion_id": sub_id,
        "monto": monto,
        "covered_by_premium": False,
        "init_point": pref.get("init_point"),
        "preapproval_id": pref.get("id"),
    })


@bp.route("/api/dashboard/vigilancia/<int:sub_id>/cancelar", methods=["POST"])
@login_required
def api_vigilancia_cancelar(sub_id: int):
    user = current_user()
    with get_session() as s:
        sub = (s.query(SuscripcionVigilancia)
               .filter_by(id=sub_id, user_id=user.id).first())
        if not sub:
            return _err("No encontrada", 404)
        if sub.status == "cancelled":
            return _ok({"already_cancelled": True})

        from services.mercadopago import cancel_subscription
        if sub.mp_subscription_id:
            cancel_subscription(sub.mp_subscription_id)

        sub.status = "cancelled"
        sub.cancelled_at = datetime.utcnow()
        s.commit()
        return _ok({"cancelled": True})


@bp.route("/api/dashboard/alertas", methods=["GET"])
@login_required
def api_alertas():
    user = current_user()
    with get_session() as s:
        rows = (s.query(AlertaVigilancia)
                .filter_by(user_id=user.id)
                .order_by(AlertaVigilancia.created_at.desc())
                .limit(200).all())
        out = []
        for a in rows:
            mc = (s.query(MarcaCliente).filter_by(id=a.marca_cliente_id).first()
                  if a.marca_cliente_id else None)
            out.append({
                "id": a.id, "score": a.score, "nivel": a.nivel,
                "marca_propia": mc.denominacion if mc else "—",
                "marca_nueva_denominacion": a.marca_nueva_denominacion,
                "marca_nueva_clase": a.marca_nueva_clase,
                "marca_nueva_titular": a.marca_nueva_titular,
                "marca_nueva_acta": a.marca_nueva_acta,
                "boletin_num": a.boletin_num,
                "created_at": a.created_at.isoformat(),
            })
        return _ok(out)


@bp.route("/api/dashboard/pagos", methods=["GET"])
@login_required
def api_pagos():
    user = current_user()
    with get_session() as s:
        rows = (s.query(Pago)
                .filter((Pago.user_id == user.id) | (Pago.email == user.email))
                .order_by(Pago.created_at.desc())
                .limit(100).all())
        return _ok([{
            "id": p.id, "tipo": p.tipo, "monto": p.monto, "moneda": p.moneda,
            "status": p.status,
            "created_at": p.created_at.isoformat(),
            "paid_at": p.paid_at.isoformat() if p.paid_at else None,
        } for p in rows])
