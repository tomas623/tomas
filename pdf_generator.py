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

# Register brand fonts. ReportLab only supports TTF/OTF-CFF2; the .otf files
# in static/fonts/ are PostScript-based OTFs which fail to register, so we
# prefer TTF files first and silently fall back to Helvetica.
#
# To enable Mundial in PDFs, drop TTF versions of the fonts here and they will
# be picked up automatically:
#   static/fonts/MundialRegular.ttf
#   static/fonts/MundialBold.ttf
#   ...
FONTS_DIR = os.path.join(os.path.dirname(__file__), "static", "fonts")
FONTS = {
    "Regular": "MundialRegular",
    "Light": "MundialLight",
    "Bold": "MundialBold",
    "Demibold": "MundialDemibold",
}

_fonts_loaded = True
for style_name, base_name in FONTS.items():
    registered = False
    for ext in (".ttf", ".otf"):
        font_path = os.path.join(FONTS_DIR, base_name + ext)
        if not os.path.exists(font_path):
            continue
        try:
            pdfmetrics.registerFont(TTFont(f"Mundial{style_name}", font_path))
            registered = True
            break
        except Exception as e:
            # PostScript-outlined OTFs trip this; we'll just fall back below.
            logger.debug(f"Could not register {font_path}: {e}")
    if not registered:
        _fonts_loaded = False

if not _fonts_loaded:
    logger.info("Brand fonts (Mundial TTF) not available — PDFs will use Helvetica.")

# Fall back to Helvetica when brand fonts are not loadable by ReportLab
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
