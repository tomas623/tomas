"""
Smoke test mínimo — sin framework obligatorio.

Corre con:  python tests/test_smoke.py     (o)   pytest tests/test_smoke.py

Objetivo: cazar regresiones baratas que ya nos mordieron — imports rotos,
mismatches de nombres entre módulos (ej. cron → run_vigilancia), plantillas de
email inexistentes, generación de PDF, y el import del boletín corriendo en un
hilo de fondo (signal solo funciona en el hilo principal).

A propósito NO importa app.py: ese módulo arranca el import del boletín en un
hilo al importarse, y no queremos efectos de red en los tests.
"""

import os
import sys
import threading

# Asegurar que la raíz del repo esté en el path al correr standalone
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_core_modules_import():
    """Todos los módulos clave importan sin error."""
    import importlib
    for mod in [
        "database", "similarity", "bulk_importer", "pdf_generator",
        "services.email", "services.whatsapp", "services.vigilancia",
        "services.mercadopago", "services.auth", "services.nurturing",
        "services.tarifas",
        "routes.marca", "routes.premium", "routes.dashboard",
        "routes.auth", "routes.pagos",
    ]:
        importlib.import_module(mod)


def test_cron_entrypoints_import():
    """Los crons importan (esto cazaba el bug de run_vigilancia)."""
    import importlib
    importlib.import_module("cron_daily")
    importlib.import_module("cron_weekly")


def test_vigilancia_alias():
    """El nombre público run_vigilancia existe y apunta a la implementación."""
    from services.vigilancia import run_vigilancia, run_vigilancia_post_import
    assert run_vigilancia is run_vigilancia_post_import


def test_email_templates_callable():
    """Las plantillas de email existen y devuelven (subject, html, text)."""
    from services import email as e

    calls = [
        e.template_magic_link("https://x/y"),
        e.template_pago_confirmado("MiMarca", 9900, "https://x/informe/1"),
        e.template_alerta_vigilancia(
            marca_propia="MiMarca", marca_nueva="OtraMarca",
            titular="Tercero SA", clase=25, nivel="alto",
            dashboard_url="https://x/dashboard"),
        e.template_vencimiento_marca(
            marca="MiMarca", fecha_vencimiento="2030-01-01",
            dias_restantes=90, dashboard_url="https://x/dashboard"),
        e.template_lead_nurturing(step=1, marca="MiMarca", search_url="https://x/"),
    ]
    for res in calls:
        assert isinstance(res, tuple) and len(res) == 3, f"plantilla no devolvió 3-tupla: {res!r}"
        subject, html, text = res
        assert subject and html, "subject/html vacíos"

    # Las que tienen firmas más largas: al menos deben existir.
    assert hasattr(e, "template_invoice")
    assert hasattr(e, "template_annual_reminder")


def test_pdf_consulta_generates():
    """El PDF del informe pago se genera y empieza con %PDF."""
    from pdf_generator import LegalPacersPDF
    buf = LegalPacersPDF().generate_consulta(
        marca="SOL", descripcion="Indumentaria", clases=[25],
        diagnostico="viable_con_ajustes",
        pre_analisis_ia="## Resumen\n**SOL** tiene coincidencias.",
        resultados=[{
            "denominacion": "SOLARIS", "clase": 25, "estado": "Registrada",
            "acta": "4.1", "titular": "X SA", "score": 0.88, "nivel": "alto",
            "scores": {"lexical": 0.9, "fonetica": 0.8, "conceptual": 0.7},
        }],
        fecha=None,
    )
    data = buf.getvalue()
    assert data[:4] == b"%PDF", "el PDF no empieza con %PDF"
    assert len(data) > 1000


def test_import_bulletin_thread_safe():
    """import_bulletin no debe romper al correr en un hilo de fondo.

    Regresión del bug 'signal only works in main thread': armaba SIGALRM siempre.
    """
    import bulk_importer as bi
    orig = bi.download_bulletin
    bi.download_bulletin = lambda num, retries=3: None  # sin red
    box = {}
    try:
        def run():
            try:
                box["res"] = bi.import_bulletin(999999, dry_run=True, timeout=5)
            except Exception as ex:  # noqa: BLE001
                box["exc"] = f"{type(ex).__name__}: {ex}"
        t = threading.Thread(target=run)
        t.start(); t.join()
    finally:
        bi.download_bulletin = orig
    assert "exc" not in box, f"import_bulletin rompió en hilo de fondo: {box.get('exc')}"
    assert box.get("res", {}).get("status") in ("error", "skip", "ok")


def _run_standalone() -> int:
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except Exception as ex:  # noqa: BLE001
            failed += 1
            print(f"FAIL  {fn.__name__}: {type(ex).__name__}: {ex}")
    print(f"\n{len(tests) - failed}/{len(tests)} tests passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_run_standalone())
