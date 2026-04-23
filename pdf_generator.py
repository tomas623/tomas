"""
PDF report generator for trademark monitoring reports using ReportLab.
"""

from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from datetime import datetime
import os
import logging

logger = logging.getLogger(__name__)

# Legal Pacers brand colors
NAVY = colors.HexColor("#0D1B4B")
BLUE = colors.HexColor("#1B6EF3")
BG_LIGHT = colors.HexColor("#F7F9FC")
TEXT_MUTED = colors.HexColor("#6B7A99")
WHITE = colors.whitesmoke

# Try to register fonts
FONTS_DIR = os.path.join(os.path.dirname(__file__), "static", "fonts")
FONTS = {
    "Regular": "MundialRegular.otf",
    "Light": "MundialLight.otf",
    "Bold": "MundialBold.otf",
    "Demibold": "MundialDemibold.otf",
}

_fonts_loaded = True
for style_name, font_file in FONTS.items():
    font_path = os.path.join(FONTS_DIR, font_file)
    if os.path.exists(font_path):
        try:
            pdfmetrics.registerFont(TTFont(f"Mundial{style_name}", font_path))
        except Exception as e:
            logger.warning(f"Could not register font {font_file}: {e}")
            _fonts_loaded = False
    else:
        logger.warning(f"Font file not found: {font_path}")
        _fonts_loaded = False

# Fall back to Helvetica when OTF fonts are not loadable by ReportLab
BASE_FONT = "MundialRegular" if _fonts_loaded else "Helvetica"
HEADING_FONT = "MundialBold" if _fonts_loaded else "Helvetica-Bold"


class LegalPacersPDF:
    """Generate branded PDF reports."""
    
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self._setup_styles()
    
    def _setup_styles(self):
        """Setup custom PDF styles with Legal Pacers branding."""
        
        self.styles.add(ParagraphStyle(
            name="LPHeading",
            fontName=HEADING_FONT,
            fontSize=24,
            textColor=NAVY,
            spaceAfter=12,
            leading=28,
        ))
        
        self.styles.add(ParagraphStyle(
            name="LPSubHeading",
            fontName=HEADING_FONT,
            fontSize=14,
            textColor=BLUE,
            spaceAfter=8,
            leading=16,
        ))
        
        self.styles.add(ParagraphStyle(
            name="LPBody",
            fontName=BASE_FONT,
            fontSize=10,
            textColor=NAVY,
            leading=12,
        ))
        
        self.styles.add(ParagraphStyle(
            name="LPMuted",
            fontName=BASE_FONT,
            fontSize=9,
            textColor=TEXT_MUTED,
            leading=10,
        ))
    
    def generate(self, marca: str, descripcion: str, variantes: list,
                 resultados: dict, clases_posiciones: dict) -> BytesIO:
        """
        Generate PDF report.
        
        Args:
            marca: Brand name
            descripcion: Brand description
            variantes: List of searched variants
            resultados: Dict of results by variant
            clases_posiciones: Dict of selected positions by class
        
        Returns:
            BytesIO containing PDF
        """
        
        pdf_buffer = BytesIO()
        doc = SimpleDocTemplate(pdf_buffer, pagesize=A4,
                                topMargin=1*cm, bottomMargin=1*cm,
                                leftMargin=1.5*cm, rightMargin=1.5*cm)
        
        story = []
        
        # Header
        story.append(self._header_section())
        story.append(Spacer(1, 0.5*cm))
        
        # Brand info
        story.append(self._brand_section(marca, descripcion))
        story.append(Spacer(1, 0.8*cm))
        
        # Search results
        if resultados:
            story.append(self._results_section(variantes, resultados))
            story.append(Spacer(1, 0.8*cm))
        
        # Selected positions
        if clases_posiciones:
            story.append(self._positions_section(clases_posiciones))
            story.append(Spacer(1, 0.8*cm))
        
        # Footer
        story.append(self._footer_section())
        
        doc.build(story)
        pdf_buffer.seek(0)
        return pdf_buffer
    
    def _header_section(self):
        """Generate PDF header with Legal Pacers branding."""
        
        data = [
            [Paragraph("<b style='font-size:18;color:#0D1B4B'>Legal Pacers</b>", self.styles["LPBody"]),
             Paragraph("<i style='font-size:10;color:#6B7A99'>Informe de Relevamiento de Marca</i>", self.styles["LPMuted"])],
        ]
        
        table = Table(data, colWidths=[10*cm, 4*cm])
        table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        
        return table
    
    def _brand_section(self, marca, descripcion):
        """Generate brand info section."""
        
        story = []
        story.append(Paragraph("Información de la Marca", self.styles["LPSubHeading"]))
        
        data = [
            ["Denominación:", Paragraph(f"<b>{marca}</b>", self.styles["LPBody"])],
            ["Descripción:", Paragraph(descripcion or "(No proporcionada)", self.styles["LPBody"])],
            ["Fecha de búsqueda:", Paragraph(datetime.now().strftime("%d/%m/%Y"), self.styles["LPBody"])],
        ]
        
        table = Table(data, colWidths=[3*cm, 10*cm])
        table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), HEADING_FONT),
            ("FONTSIZE", (0, 0), (0, -1), 10),
            ("TEXTCOLOR", (0, 0), (0, -1), NAVY),
            ("ALIGN", (0, 0), (0, -1), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [WHITE, BG_LIGHT]),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        
        story.append(table)
        return story[0] if len(story) == 1 else Table([[s] for s in story])
    
    def _results_section(self, variantes, resultados):
        """Generate search results section."""
        
        story = []
        story.append(Paragraph("Resultados de Búsqueda INPI", self.styles["LPSubHeading"]))
        
        total_results = sum(len(r) for r in resultados.values())
        
        if total_results == 0:
            story.append(Paragraph("No se encontraron marcas registradas que coincidan con su búsqueda.", 
                                  self.styles["LPMuted"]))
        else:
            for variant in variantes:
                results = resultados.get(variant, [])
                if results:
                    story.append(Paragraph(f"Variante: <b>{variant}</b>", self.styles["LPBody"]))
                    story.append(Spacer(1, 0.3*cm))
                    
                    table_data = [
                        ["Denominación", "Clase", "Estado", "Titular", "Vencimiento"],
                    ]
                    
                    for r in results[:10]:  # Limit to 10 per variant for PDF size
                        estado_text = r.get("estado", "")
                        table_data.append([
                            r.get("denominacion", "")[:30],
                            str(r.get("clase", "")),
                            estado_text[:15],
                            r.get("titulares", "")[:25],
                            r.get("fecha_vencimiento", "")[:10] or "-",
                        ])
                    
                    table = Table(table_data, colWidths=[3*cm, 1.5*cm, 2*cm, 3*cm, 2*cm])
                    table.setStyle(TableStyle([
                        ("FONTNAME", (0, 0), (-1, 0), HEADING_FONT),
                        ("FONTSIZE", (0, 0), (-1, -1), 8),
                        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, BG_LIGHT]),
                        ("PADDING", (0, 0), (-1, -1), 3),
                    ]))
                    
                    story.append(table)
                    story.append(Spacer(1, 0.5*cm))
        
        return story[0] if len(story) == 1 else Table([[s] for s in story], colWidths=[13*cm])
    
    def _positions_section(self, clases_posiciones):
        """Generate selected positions section."""
        
        story = []
        story.append(Paragraph("Posiciones Seleccionadas", self.styles["LPSubHeading"]))
        
        for clase_num, posiciones in sorted(clases_posiciones.items()):
            story.append(Paragraph(f"Clase {clase_num}", self.styles["LPBody"]))
            
            pos_text = ", ".join([f"{p.get('partida', '')}" for p in posiciones[:5]])
            if len(posiciones) > 5:
                pos_text += f"... (+{len(posiciones) - 5} más)"
            
            story.append(Paragraph(pos_text, self.styles["LPMuted"]))
            story.append(Spacer(1, 0.3*cm))
        
        return story[0] if len(story) == 1 else Table([[s] for s in story], colWidths=[13*cm])
    
    def _footer_section(self):
        """Generate footer with contact info."""

        footer_text = """
        <b>Legal Pacers</b> — Monitoreo y Registro de Marcas<br/>
        <a href="https://api.whatsapp.com/send/?phone=5491128774200">WhatsApp: +54 9 11 2877-4200</a> |
        <a href="https://www.legalpacers.com">www.legalpacers.com</a><br/>
        <i style='font-size:8'>Este informe fue generado automáticamente. Consulte las bases de datos oficiales del INPI para información actualizada.</i>
        """

        return Paragraph(footer_text, self.styles["LPMuted"])


# ─────────────────────────────────────────────────────────────────────
# Premium availability report (Module A)
# ─────────────────────────────────────────────────────────────────────

RISK_COLORS = {
    "bajo":  colors.HexColor("#16A34A"),
    "medio": colors.HexColor("#D97706"),
    "alto":  colors.HexColor("#DC2626"),
}


def _risk_badge_style(riesgo: str):
    col = RISK_COLORS.get((riesgo or "").lower(), colors.HexColor("#6B7A99"))
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), col),
        ("TEXTCOLOR",  (0, 0), (-1, -1), WHITE),
        ("FONTNAME",   (0, 0), (-1, -1), HEADING_FONT),
        ("FONTSIZE",   (0, 0), (-1, -1), 9),
        ("ALIGN",      (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",(0, 0), (-1, -1), 8),
        ("RIGHTPADDING",(0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 3),
    ])


def build_disponibilidad_report(user_email: str, clases, enriched: list[dict]) -> bytes:
    """
    Build the premium disponibilidad PDF.

    `clases` can be int or list[int]. `enriched` items:
      {marca, clase, disponible, exactas[], similares[], similares_count,
       ai_riesgo, ai_justificacion, ai_clases_sugeridas[]}
    Returns PDF bytes.
    """
    if isinstance(clases, int):
        clases_list = [clases]
    else:
        clases_list = list(clases) if clases else []

    pdf = LegalPacersPDF()
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=1.2*cm, bottomMargin=1.2*cm,
        leftMargin=1.5*cm, rightMargin=1.5*cm,
    )
    story = []

    # Header
    hdr = Table(
        [[Paragraph("<b style='font-size:18;color:#0D1B4B'>Legal Pacers</b>",
                    pdf.styles["LPBody"]),
          Paragraph("<i style='font-size:10;color:#6B7A99'>Reporte de disponibilidad de marca</i>",
                    pdf.styles["LPMuted"])]],
        colWidths=[10*cm, 7*cm],
    )
    hdr.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(hdr)
    story.append(Spacer(1, 0.3*cm))

    clases_text = (
        f"Clase {clases_list[0]}" if len(clases_list) == 1
        else f"{len(clases_list)} clases: {', '.join(str(c) for c in clases_list)}"
    ) if clases_list else "—"
    story.append(Paragraph(
        f"Email: <b>{user_email}</b> · Clases de Niza consultadas: <b>{clases_text}</b> · "
        f"Fecha: <b>{datetime.now().strftime('%d/%m/%Y')}</b>",
        pdf.styles["LPMuted"],
    ))
    story.append(Spacer(1, 0.5*cm))

    # One section per denomination
    for idx, item in enumerate(enriched):
        if idx > 0:
            story.append(Spacer(1, 0.3*cm))

        disponible = item.get("disponible", False)
        dispo_text = "✓ Disponible" if disponible else "✗ No disponible"
        dispo_color = "#16A34A" if disponible else "#DC2626"

        clase_txt = f" — Clase {item.get('clase','')}" if item.get('clase') else ""
        title = Paragraph(
            f"<b>{item.get('marca','')}</b>{clase_txt}  "
            f"<font color='{dispo_color}'>{dispo_text}</font>",
            pdf.styles["LPSubHeading"],
        )
        story.append(title)

        # Risk badge + justification
        riesgo = (item.get("ai_riesgo") or "medio").lower()
        badge = Table([[f"Riesgo {riesgo.upper()}"]], colWidths=[3.5*cm])
        badge.setStyle(_risk_badge_style(riesgo))
        story.append(badge)
        story.append(Spacer(1, 0.2*cm))

        if item.get("ai_justificacion"):
            story.append(Paragraph(item["ai_justificacion"], pdf.styles["LPBody"]))
            story.append(Spacer(1, 0.25*cm))

        # AI suggested classes
        clases_sug = item.get("ai_clases_sugeridas") or []
        if clases_sug:
            story.append(Paragraph("<b>Clases de Niza sugeridas para proteger esta marca:</b>",
                                   pdf.styles["LPBody"]))
            data = [["Clase", "Motivo"]] + [
                [str(c.get("clase","")), str(c.get("motivo",""))[:140]]
                for c in clases_sug
            ]
            t = Table(data, colWidths=[1.5*cm, 15*cm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR",  (0, 0), (-1, 0), WHITE),
                ("FONTNAME",   (0, 0), (-1, 0), HEADING_FONT),
                ("FONTSIZE",   (0, 0), (-1, -1), 9),
                ("GRID",       (0, 0), (-1, -1), 0.5, colors.lightgrey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, BG_LIGHT]),
                ("VALIGN",     (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING",(0, 0), (-1, -1), 5),
                ("RIGHTPADDING",(0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING",(0, 0), (-1, -1), 4),
            ]))
            story.append(t)
            story.append(Spacer(1, 0.35*cm))

        # Similar/exact marks table
        rows = (item.get("exactas") or []) + (item.get("similares") or [])
        if rows:
            story.append(Paragraph(
                f"<b>Marcas encontradas ({len(rows)}):</b>",
                pdf.styles["LPBody"],
            ))
            data = [["Denominación", "Clase", "Acta", "Estado", "Titular"]]
            for r in rows[:50]:
                data.append([
                    (r.get("denominacion","") or "")[:36],
                    str(r.get("clase","")),
                    (r.get("acta","") or "")[:14],
                    (r.get("estado","") or "")[:18],
                    (r.get("titulares","") or "")[:40],
                ])
            t = Table(data, colWidths=[4.5*cm, 1.3*cm, 2.3*cm, 3*cm, 5.4*cm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR",  (0, 0), (-1, 0), WHITE),
                ("FONTNAME",   (0, 0), (-1, 0), HEADING_FONT),
                ("FONTSIZE",   (0, 0), (-1, -1), 8),
                ("GRID",       (0, 0), (-1, -1), 0.3, colors.lightgrey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, BG_LIGHT]),
                ("VALIGN",     (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING",(0, 0), (-1, -1), 4),
                ("RIGHTPADDING",(0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING",(0, 0), (-1, -1), 3),
            ]))
            story.append(t)
            if len(rows) > 50:
                story.append(Paragraph(
                    f"<i>(+{len(rows)-50} más no listadas)</i>",
                    pdf.styles["LPMuted"],
                ))
        else:
            story.append(Paragraph(
                "No se encontraron marcas idénticas ni fonéticamente similares en la base.",
                pdf.styles["LPMuted"],
            ))

        story.append(Spacer(1, 0.4*cm))
        if idx < len(enriched) - 1:
            story.append(PageBreak())

    # Disclaimer + footer
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph(
        "<i>Este reporte es una herramienta informativa y no constituye un dictamen legal. "
        "El análisis de riesgo es asistido por IA y debe ser validado por un profesional antes de "
        "presentar una solicitud ante el INPI. Los datos de marcas provienen del boletín oficial del INPI.</i>",
        pdf.styles["LPMuted"],
    ))
    story.append(Spacer(1, 0.3*cm))
    story.append(pdf._footer_section())

    doc.build(story)
    buf.seek(0)
    return buf.getvalue()
