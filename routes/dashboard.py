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
from services.auth import current_user, login_required

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
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0">Mis marcas registradas</h3>
      <button class="small" @click="modalMarca=true">+ Agregar marca</button>
    </div>
    <p x-show="!marcas.length" class="empty">Cargá tus marcas para activar la vigilancia mensual.</p>
    <table x-show="marcas.length">
      <thead><tr><th>Denominación</th><th>Clase</th><th>Estado</th><th>Vence</th><th></th></tr></thead>
      <tbody>
        <template x-for="m in marcas" :key="m.id">
          <tr>
            <td><strong x-text="m.denominacion"></strong></td>
            <td x-text="m.clase || '—'"></td>
            <td><span class="badge gray" x-text="m.estado||'—'"></span></td>
            <td x-text="m.fecha_vencimiento || '—'"></td>
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

  <!-- VIGILANCIA -->
  <div x-show="tab==='vigilancia'" class="card">
    <h3 style="margin-top:0">Suscripciones de vigilancia</h3>
    <p style="color:#64748b">
      Cada miércoles, cuando el INPI publica su boletín, escaneamos automáticamente
      las nuevas marcas y te alertamos por email si alguna se parece a la tuya.
      <strong>$<span x-text="precios.vigilancia_marca.toLocaleString('es-AR')"></span> ARS / marca / mes</strong>.
    </p>
    <p x-show="!vigilancia.length" class="empty">Aún no tenés vigilancia activa. Agregá una marca y activala.</p>
    <table x-show="vigilancia.length">
      <thead><tr><th>Marca vigilada</th><th>Tipo</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        <template x-for="v in vigilancia" :key="v.id">
          <tr>
            <td x-text="v.marca_nombre || '(portfolio)'"></td>
            <td x-text="v.tipo"></td>
            <td>$<span x-text="v.monto.toLocaleString('es-AR')"></span></td>
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
    <div class="modal-content">
      <h3 style="margin-top:0">Agregar marca</h3>
      <label>Denominación</label>
      <input type="text" x-model="nueva.denominacion">
      <label>Clase Nice</label>
      <input type="number" x-model.number="nueva.clase" min="1" max="45">
      <label>Acta INPI (opcional)</label>
      <input type="text" x-model="nueva.acta">
      <label>Fecha de vencimiento (opcional)</label>
      <input type="date" x-model="nueva.fecha_vencimiento">
      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="sec" @click="modalMarca=false" style="flex:1">Cancelar</button>
        <button @click="guardarMarca()" style="flex:1">Guardar</button>
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
    modalMarca: false, nueva: {denominacion:'', clase:null, acta:'', fecha_vencimiento:''},

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
    hasVigilancia(marcaId){
      return this.vigilancia.some(v => v.marca_cliente_id===marcaId && v.status==='active');
    },
    async guardarMarca(){
      const r = await fetch('/api/dashboard/marcas',{method:'POST',headers:{'Content-Type':'application/json'},
        body: JSON.stringify(this.nueva)}).then(r=>r.json());
      if(!r.ok){ alert(r.error||'Error'); return; }
      this.modalMarca=false;
      this.nueva={denominacion:'',clase:null,acta:'',fecha_vencimiento:''};
      await this.fetchMarcas();
    },
    async iniciarVigilancia(marcaId){
      const r = await fetch('/api/dashboard/vigilancia/activar',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({marca_cliente_id: marcaId})}).then(r=>r.json());
      if(!r.ok){ alert(r.error||'Error'); return; }
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
@login_required
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
        return _ok([{
            "id": m.id, "denominacion": m.denominacion, "clase": m.clase,
            "acta": m.acta, "estado": m.estado, "titular": m.titular,
            "fecha_solicitud": m.fecha_solicitud.isoformat() if m.fecha_solicitud else None,
            "fecha_vencimiento": m.fecha_vencimiento.isoformat() if m.fecha_vencimiento else None,
        } for m in rows])


@bp.route("/api/dashboard/marcas", methods=["POST"])
@login_required
def api_marcas_add():
    user = current_user()
    data = request.get_json(silent=True) or {}
    deno = (data.get("denominacion") or "").strip()
    if not deno:
        return _err("Denominación requerida")

    fecha_venc = data.get("fecha_vencimiento")
    fecha_solic = data.get("fecha_solicitud")

    def _parse_date(v):
        if not v:
            return None
        try:
            return datetime.fromisoformat(v).date()
        except Exception:
            return None

    with get_session() as s:
        m = MarcaCliente(
            user_id=user.id,
            denominacion=deno,
            clase=data.get("clase"),
            acta=(data.get("acta") or "").strip() or None,
            titular=(data.get("titular") or "").strip() or None,
            estado=(data.get("estado") or "").strip() or None,
            fecha_solicitud=_parse_date(fecha_solic),
            fecha_vencimiento=_parse_date(fecha_venc),
            notas=(data.get("notas") or "").strip() or None,
        )
        s.add(m)
        s.commit()
        return _ok({"id": m.id}, 201)


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
