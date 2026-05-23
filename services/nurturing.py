"""
Secuencia de lead nurturing automática.

Tres emails post consulta gratuita:
  D+1  → 3 razones para registrar
  D+4  → plazos y costos reales (CTA cotizar registro)
  D+10 → urgencia + WhatsApp

Se ejecuta una vez al día (Task Scheduler diario o cron). Para cada Lead
con `fuente='consulta_gratuita'`, calcula los días desde `created_at` y
envía el email correspondiente si todavía no fue enviado (`nurtured_step`
guarda el último step enviado).

Idempotencia: marca `nurtured_step` y `nurtured_at` después de cada envío.
Dos corridas el mismo día no duplican emails.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta

from database import Lead, get_session
from services.email import send_email, template_lead_nurturing

logger = logging.getLogger(__name__)


SECUENCIA = [
    (1, 1),    # step 1: enviar a partir de D+1 — bienvenida + valor
    (2, 4),    # step 2: enviar a partir de D+4 — plazos y costos
    (3, 15),   # step 3: enviar a partir de D+15 — RECORDATORIO con 10% OFF
]

INFORME_PROMO_CODE = os.getenv("INFORME_PROMO_CODE", "VOLVER10")
INFORME_PROMO_PCT = int(os.getenv("INFORME_RECORDATORIO_DESCUENTO_PCT", "10"))


def run_lead_nurturing() -> int:
    """Procesa todos los leads y envía el siguiente email de la secuencia."""
    enviados = 0
    ahora = datetime.utcnow()
    base = os.getenv("APP_BASE_URL", "")

    with get_session() as s:
        # Leads de búsquedas gratuitas: consulta directa o captura post-resultado.
        # No incluye cotización ni contacto (esos tienen su propio flujo).
        leads = (s.query(Lead)
                 .filter(Lead.fuente.in_(["consulta_gratuita", "seguimiento_resultado"]))
                 .filter(Lead.nurtured_step < 3)
                 .all())

        for lead in leads:
            edad = (ahora - lead.created_at).days
            siguiente_step = lead.nurtured_step + 1

            # Buscar la entrada de SECUENCIA para el siguiente step
            cuando = next((d for st, d in SECUENCIA if st == siguiente_step), None)
            if cuando is None or edad < cuando:
                continue

            # Step 3 incluye código de descuento en la URL
            params = []
            if lead.marca:
                params.append(f"marca={lead.marca}")
            if siguiente_step == 3:
                params.append(f"promo={INFORME_PROMO_CODE}")
            search_url = (base + "/?" + "&".join(params)) if params else (base or "/")
            subject, html, text = template_lead_nurturing(
                step=siguiente_step,
                marca=lead.marca or "tu marca",
                search_url=search_url,
                promo_code=(INFORME_PROMO_CODE if siguiente_step == 3 else None),
                promo_pct=(INFORME_PROMO_PCT if siguiente_step == 3 else None),
            )
            if send_email(lead.email, subject, html, text=text):
                lead.nurtured_step = siguiente_step
                lead.nurtured_at = ahora
                enviados += 1

        s.commit()

    logger.info(f"Lead nurturing: {enviados} emails enviados")
    return enviados
