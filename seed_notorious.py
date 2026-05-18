"""
Construye la lista de marcas notorias combinando 3 fuentes:

1. Lista global hardcodeada (top brands mundiales — Interbrand-style)
2. Auto-detección desde la DB local: marcas registradas en N+ clases por
   el mismo titular (criterio que usa el INPI para inferir notoriedad)
3. Override manual desde notorious_brands.txt (línea por marca)

Uso:
  python seed_notorious.py            # genera/actualiza notorious_brands.txt
  python seed_notorious.py --min 3    # umbral de clases para auto-detección
  python seed_notorious.py --solo-local   # solo desde DB, sin lista global

El archivo resultante se carga automáticamente cuando la app levanta.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from collections import defaultdict

from database import Marca, get_session, init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────
# 1. Lista global hardcodeada (top ~250 globales + locales adicionales)
# ─────────────────────────────────────────────────────────────────────

GLOBAL_NOTORIAS = [
    # Tech / software
    "Apple", "Google", "Microsoft", "Amazon", "Meta", "Facebook", "Instagram",
    "WhatsApp", "TikTok", "Twitter", "X.com", "LinkedIn", "YouTube", "Netflix",
    "Spotify", "Uber", "Airbnb", "PayPal", "Stripe", "Shopify", "Adobe",
    "Oracle", "Salesforce", "SAP", "IBM", "Intel", "AMD", "Nvidia",
    "Samsung", "Sony", "LG", "Huawei", "Xiaomi", "OPPO", "Vivo", "OnePlus",
    "HP", "Dell", "Lenovo", "Asus", "Acer", "Cisco", "VMware", "Zoom",
    "Slack", "Notion", "Dropbox", "GitHub", "GitLab", "Atlassian", "Jira",
    "Discord", "Telegram", "Signal", "Snap", "Snapchat", "Pinterest", "Reddit",
    "Twitch", "Roblox", "Epic Games", "Unity", "Unreal Engine",
    "ChatGPT", "OpenAI", "Anthropic", "Claude", "Gemini", "Bard",

    # Refrescos / bebidas
    "Coca-Cola", "Coca Cola", "Pepsi", "Pepsi-Cola", "Sprite", "Fanta",
    "Mountain Dew", "Dr Pepper", "Red Bull", "Monster", "Gatorade", "Powerade",
    "7up", "Schweppes", "Canada Dry", "Crush", "Tab",
    "Nesquik", "Nescafé", "Nescafe", "Twinings", "Lipton",

    # Cervezas / alcohol
    "Heineken", "Budweiser", "Corona", "Stella Artois", "Carlsberg", "Guinness",
    "Modelo", "Brahma", "Skol", "Polar", "Amstel", "Beck's", "Becks",
    "Johnnie Walker", "Jack Daniel's", "Jack Daniels", "Bacardi", "Smirnoff",
    "Absolut", "Captain Morgan", "Jose Cuervo", "Patrón", "Hennessy", "Martell",
    "Moët", "Moet", "Veuve Clicquot", "Dom Pérignon", "Dom Perignon",

    # Alimentos / snacks
    "Nestlé", "Nestle", "Unilever", "Kraft", "Heinz", "Mondelez", "Cadbury",
    "Hershey", "Kellogg", "Kelloggs", "Oreo", "Toblerone", "Ferrero",
    "Ferrero Rocher", "Lindt", "Milka", "Nutella", "Kinder", "Pringles",
    "Doritos", "Lay's", "Lays", "Cheetos", "Snickers", "Mars", "Twix",
    "M&M's", "MMs", "Bounty", "Kit Kat", "KitKat", "Magnum", "Häagen-Dazs",
    "Häagen Dazs", "Haagen-Dazs", "Ben & Jerry's", "Danone",

    # Indumentaria / deporte
    "Nike", "Adidas", "Puma", "Reebok", "Under Armour", "Converse", "Vans",
    "New Balance", "Asics", "Fila", "Kappa", "Lacoste", "Tommy Hilfiger",
    "Calvin Klein", "Levi's", "Levis", "Hugo Boss", "Ralph Lauren", "Polo Ralph Lauren",
    "Diesel", "Tommy", "Champion", "Carhartt", "The North Face", "Patagonia",
    "Columbia", "Timberland", "Quiksilver", "Billabong", "Rip Curl", "Oakley",
    "Ray-Ban", "Ray Ban", "Persol",

    # Lujo
    "Gucci", "Louis Vuitton", "Chanel", "Hermès", "Hermes", "Prada", "Versace",
    "Armani", "Dior", "Christian Dior", "Burberry", "Fendi", "Balenciaga",
    "Bvlgari", "Bulgari", "Cartier", "Tiffany", "Tiffany & Co", "Rolex",
    "Omega", "Patek Philippe", "Audemars Piguet", "Tag Heuer", "Breitling",
    "Montblanc", "Mont Blanc", "Yves Saint Laurent", "YSL", "Givenchy", "Loewe",

    # Autos
    "Mercedes-Benz", "Mercedes Benz", "Mercedes", "BMW", "Audi", "Volkswagen",
    "Porsche", "Ferrari", "Lamborghini", "Maserati", "Bugatti", "Bentley",
    "Rolls-Royce", "Rolls Royce", "Aston Martin", "Jaguar", "Land Rover",
    "Range Rover", "Toyota", "Lexus", "Honda", "Acura", "Nissan", "Infiniti",
    "Mazda", "Subaru", "Mitsubishi", "Suzuki", "Hyundai", "Kia", "Genesis",
    "Ford", "Lincoln", "Chevrolet", "Chevy", "Cadillac", "Dodge", "Jeep",
    "Chrysler", "Ram", "GMC", "Buick", "Tesla", "Rivian", "Lucid",
    "Peugeot", "Citroën", "Citroen", "Renault", "Dacia", "Fiat", "Alfa Romeo",
    "Volvo", "Saab", "Skoda", "Seat",

    # Entretenimiento / medios
    "Disney", "Walt Disney", "Pixar", "Marvel", "Lucasfilm", "Star Wars",
    "Warner", "Warner Bros", "HBO", "ESPN", "Paramount", "Universal",
    "20th Century Fox", "Sony Pictures", "MGM", "DreamWorks",
    "BBC", "CNN", "Fox News", "Bloomberg", "Reuters", "Forbes",

    # Bancos / pagos
    "Visa", "Mastercard", "American Express", "Amex", "Discover", "JCB",
    "Santander", "BBVA", "HSBC", "Citi", "Citibank", "JPMorgan", "Wells Fargo",
    "Bank of America", "Morgan Stanley", "Goldman Sachs", "Deutsche Bank",
    "BNP Paribas", "Société Générale", "ING", "Barclays",

    # Comida rápida
    "McDonald's", "McDonalds", "Burger King", "Wendy's", "KFC", "Subway",
    "Pizza Hut", "Domino's", "Dominos", "Papa John's", "Taco Bell",
    "Starbucks", "Dunkin'", "Dunkin", "Tim Hortons", "Costa Coffee",
    "Five Guys", "Chipotle", "Shake Shack", "In-N-Out",

    # Retail / hogar
    "IKEA", "Walmart", "Carrefour", "Target", "Costco", "Sam's Club",
    "Home Depot", "Lowe's", "Best Buy", "Macy's", "Sears", "JCPenney",
    "H&M", "Zara", "Uniqlo", "Bershka", "Stradivarius", "Pull&Bear",
    "Mango", "Gap", "Old Navy", "Banana Republic", "Forever 21",
    "Sephora", "L'Oréal", "Loreal", "Maybelline", "MAC", "Estée Lauder",
    "Clinique", "Lancôme", "Lancome", "Olay", "Dove",
    "Colgate", "Crest", "Oral-B", "Listerine", "Pampers", "Huggies",
    "Tide", "Ariel", "Persil", "Gillette", "Old Spice", "Axe", "Rexona",

    # Hotelería / viajes
    "Hilton", "Marriott", "Sheraton", "Hyatt", "InterContinental", "Holiday Inn",
    "Best Western", "Ibis", "Accor", "Mandarin Oriental",
    "American Airlines", "Delta", "United", "Lufthansa", "Air France",
    "British Airways", "Emirates", "Qatar Airways", "Singapore Airlines",
    "Booking.com", "Expedia", "Trivago", "Kayak", "TripAdvisor", "Skyscanner",

    # Argentina locales
    "Quilmes", "Patagonia Cerveza", "Arcor", "La Serenísima", "La Serenisima",
    "Havanna", "Bagley", "Mostaza", "Despegar", "Manaos", "Pritty", "Levité",
    "Levite", "Villavicencio", "Eco de los Andes", "Glaciar", "Cunnington",
    "Paso de los Toros", "Branca", "Fernet Branca", "Cinzano", "Gancia",
    "Hesperidina", "Brahma", "Sancor", "Milkaut", "Ilolay", "Tregar",
    "Mastellone", "Las Marías", "Las Marias", "Taragüí", "Taragui",
    "Cruz de Malta", "Playadito", "Rosamonte", "Don Satur", "9 de Oro",
    "Terrabusi", "Coto", "Día", "Disco", "Jumbo", "Vea", "Easy", "Garbarino",
    "Frávega", "Fravega", "Musimundo", "Banco Galicia", "Galicia",
    "Banco Macro", "Macro", "Banco Provincia", "Banco Nación", "Banco Nacion",
    "Brubank", "Ualá", "Uala", "Naranja X", "Naranja", "Mercado Pago",
    "MercadoPago", "Mercado Libre", "MercadoLibre", "Personal", "Movistar",
    "Claro", "Telecom", "Cablevisión", "Cablevision", "Flow", "Telecentro",
    "Clarín", "Clarin", "La Nación", "La Nacion", "Página 12", "Pagina 12",
    "Infobae", "TN", "Todo Noticias", "Canal 13", "Telefe", "C5N",
    "Tiendanube", "Tienda Nube", "Ripio", "Lemon Cash", "Pedidos Ya",
    "PedidosYa", "Rappi", "Globant", "YPF", "Axion", "Shell Argentina",
    "Puma Energy", "ESSO", "Petrobras",
]


# ─────────────────────────────────────────────────────────────────────
# 2. Auto-detección desde la DB
# ─────────────────────────────────────────────────────────────────────

def detectar_notorias_locales(min_clases: int = 3) -> set[str]:
    """Encuentra marcas registradas en N+ clases por el mismo titular.

    El INPI argentino considera 'notoria' a una marca con registro multi-clase
    + reconocimiento del público. Esta heurística captura la primera parte:
    si un titular registró la misma denominación en 3+ clases, casi siempre
    es porque considera que su marca debe protegerse en todas.
    """
    notorias: set[str] = set()
    counts: dict[tuple[str, str], set[int]] = defaultdict(set)

    with get_session() as s:
        # Iteramos en chunks para no cargar todo en memoria
        offset = 0
        chunk = 5000
        while True:
            rows = (s.query(Marca.denominacion, Marca.titular, Marca.clase)
                    .filter(Marca.titular.is_not(None),
                            Marca.denominacion.is_not(None),
                            Marca.clase.is_not(None))
                    .offset(offset).limit(chunk).all())
            if not rows:
                break
            for deno, tit, cls in rows:
                key = (deno.strip().lower(), tit.strip().lower())
                counts[key].add(cls)
            offset += chunk
            if offset % 50000 == 0:
                logger.info(f"  scanned {offset} marcas...")

    for (deno, _tit), clases in counts.items():
        if len(clases) >= min_clases:
            # Recuperar la versión original con mayúsculas
            notorias.add(deno.title())

    return notorias


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--min", type=int, default=3,
                        help="Mínimo de clases por titular+denominación para auto-detección")
    parser.add_argument("--solo-local", action="store_true",
                        help="No incluir la lista global hardcodeada")
    parser.add_argument("--solo-global", action="store_true",
                        help="No escanear la DB, solo lista global")
    args = parser.parse_args()

    init_db()

    todas: set[str] = set()
    if not args.solo_local:
        logger.info(f"Cargando {len(GLOBAL_NOTORIAS)} marcas globales...")
        todas.update(GLOBAL_NOTORIAS)

    if not args.solo_global:
        logger.info(f"Escaneando DB por titulares con {args.min}+ clases...")
        locales = detectar_notorias_locales(min_clases=args.min)
        logger.info(f"Encontradas {len(locales)} marcas locales con multi-clase")
        todas.update(locales)

    # Escribir notorious_brands.txt
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "notorious_brands.txt")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("# Generado por seed_notorious.py — editar manualmente para ajustes finos.\n")
        fh.write(f"# {len(todas)} marcas — fuentes: global hardcodeada + DB local (≥{args.min} clases/titular).\n")
        fh.write("\n")
        for brand in sorted(todas):
            fh.write(f"{brand}\n")

    logger.info(f"OK: {len(todas)} marcas escritas en {out_path}")
    logger.info("Reiniciá la app para que tome la lista nueva.")


if __name__ == "__main__":
    main()
