"""
Tarifas INPI + honorarios LegalPacers.

Las tasas oficiales del INPI cambian periódicamente. En vez de hardcodearlas,
se cargan desde data/tasas_inpi.json y se exponen vía API. El admin puede
editarlas desde el panel sin tocar código.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_TARIFAS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "tasas_inpi.json",
)

DEFAULT_TARIFAS = {
    "_meta": {"fecha_actualizacion": "default", "fuente": "fallback"},
    "tasas_inpi": {
        "solicitud_marca_x_clase": 31480,
        "renovacion_marca_x_clase": 31480,
        "presentacion_oposicion": 28100,
        "modificacion_marca": 14130,
        "transferencia_marca": 14130,
        "declaracion_uso_5_anios": 12010,
    },
    "honorarios_lp": {
        "registro_1_clase": 75000,
        "registro_clase_adicional": 25000,
        "presentacion_oposicion_simple": 95000,
        "presentacion_oposicion_compleja": 180000,
        "respuesta_oposicion": 120000,
        "declaracion_uso": 25000,
        "renovacion_marca": 35000,
        "informe_completo_descuento_pct": 0,
    },
    "descuentos": {
        "anual_meses_gratis": 2,
        "pago_unico_dos_o_mas_clases_pct": 10,
    },
}


def load_tarifas() -> dict:
    """Carga las tarifas del archivo. Si no existe o está corrupto, devuelve defaults."""
    if not os.path.exists(_TARIFAS_PATH):
        return dict(DEFAULT_TARIFAS)
    try:
        with open(_TARIFAS_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        # Merge con defaults para que nunca falte una key esperada
        merged = dict(DEFAULT_TARIFAS)
        for k, v in (data or {}).items():
            if isinstance(v, dict) and k in merged and isinstance(merged[k], dict):
                merged[k] = {**merged[k], **v}
            else:
                merged[k] = v
        return merged
    except Exception as e:
        logger.warning(f"No pude leer tasas_inpi.json: {e}")
        return dict(DEFAULT_TARIFAS)


def save_tarifas(data: dict) -> bool:
    """Persiste las tarifas al archivo. Solo admin debería llamar esto."""
    try:
        os.makedirs(os.path.dirname(_TARIFAS_PATH), exist_ok=True)
        with open(_TARIFAS_PATH, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.warning(f"No pude guardar tasas_inpi.json: {e}")
        return False


def calcular_registro(num_clases: int, incluye_honorarios: bool = True) -> dict:
    """Calcula el costo total estimado de registrar N clases.

    Devuelve breakdown: tasas INPI, honorarios LP, descuentos, total final.
    """
    if num_clases < 1:
        num_clases = 1
    t = load_tarifas()
    tasas = t.get("tasas_inpi", {})
    hon = t.get("honorarios_lp", {})
    desc = t.get("descuentos", {})

    tasa_unitaria = float(tasas.get("solicitud_marca_x_clase", 0))
    total_tasas = tasa_unitaria * num_clases

    if incluye_honorarios:
        h_primera = float(hon.get("registro_1_clase", 0))
        h_adicional = float(hon.get("registro_clase_adicional", 0))
        total_honorarios = h_primera + h_adicional * max(0, num_clases - 1)
    else:
        total_honorarios = 0.0

    descuento_pct = 0
    if num_clases >= 2:
        descuento_pct = int(desc.get("pago_unico_dos_o_mas_clases_pct", 0))
    descuento_monto = round(total_honorarios * descuento_pct / 100.0)

    total = total_tasas + total_honorarios - descuento_monto

    return {
        "num_clases": num_clases,
        "tasas_inpi": {
            "unitaria": tasa_unitaria,
            "total": total_tasas,
        },
        "honorarios_lp": {
            "primera_clase": float(hon.get("registro_1_clase", 0)) if incluye_honorarios else 0,
            "clase_adicional": float(hon.get("registro_clase_adicional", 0)) if incluye_honorarios else 0,
            "total": total_honorarios,
        },
        "descuento": {
            "pct": descuento_pct,
            "monto": descuento_monto,
        },
        "total": total,
        "fecha_actualizacion": t.get("_meta", {}).get("fecha_actualizacion"),
    }
