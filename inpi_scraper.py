"""
INPI (Argentina) trademark portal scraper.
Searches for trademark registrations and returns results.
"""

import httpx
import time
from typing import List, Dict, Optional
from bs4 import BeautifulSoup
import logging

logger = logging.getLogger(__name__)

# INPI portal URL
INPI_BASE = "https://portaltramites.inpi.gob.ar"
INPI_SEARCH_URL = f"{INPI_BASE}/tramite-marca/buscar-denominacion"

# Estados mapping
ESTADO_MAP = {
    "vigente": "vigente",
    "vencida": "vencida",
    "en trámite": "tramite",
    "oposición": "oposicion",
    "caducada": "caducada",
    "abandonada": "abandonada",
    "cancelada": "cancelada",
}


def search_inpi(variant: str, classes: List[int], timeout: int = 30) -> List[Dict]:
    """
    Search INPI portal for a trademark variant.
    
    Args:
        variant: Trademark name to search
        classes: List of INPI Nice classes to filter by
        timeout: Request timeout in seconds
    
    Returns:
        List of matching trademarks with fields:
        {denominacion, tipo, clase, estado, estado_code, titulares, fecha_vencimiento, acta}
    """
    
    results = []
    
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            # Try direct search with GET parameters first
            params = {
                "denominacion": variant,
                "marcaInteligente": "true",
            }
            
            logger.info(f"Searching INPI for '{variant}' in classes {classes}")
            
            # Attempt 1: Try JSON API endpoint (common in INPI portal)
            try:
                api_url = f"{INPI_BASE}/api/v1/marcas/search"
                api_params = {
                    "denominacion": variant,
                    "clases": ",".join(str(c) for c in classes) if classes else None,
                }
                resp = client.get(api_url, params=api_params)
                
                if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("application/json"):
                    try:
                        data = resp.json()
                        if isinstance(data, dict) and "results" in data:
                            results = _parse_api_results(data.get("results", []))
                            if results:
                                logger.info(f"Found {len(results)} results via API")
                                return _filter_by_classes(results, classes)
                    except:
                        logger.debug("API JSON parsing failed, trying HTML scrape")
            except Exception as e:
                logger.debug(f"API attempt failed: {e}")
            
            # Attempt 2: HTML form submission & scrape
            results = _scrape_html_search(client, variant, classes, timeout)
            
    except httpx.TimeoutException:
        logger.error(f"INPI search timeout for '{variant}'")
        return []
    except Exception as e:
        logger.error(f"INPI search error for '{variant}': {e}")
        return []
    
    return results


def _scrape_html_search(client: httpx.Client, variant: str, classes: List[int], timeout: int) -> List[Dict]:
    """Scrape INPI portal HTML search results."""
    
    results = []
    
    try:
        # POST to search endpoint
        data = {
            "denominacion": variant,
            "marcaInteligente": "true",
            "buscar": "Buscar",
        }
        
        resp = client.post(INPI_SEARCH_URL, data=data, timeout=timeout)
        resp.raise_for_status()
        
        # Parse HTML
        soup = BeautifulSoup(resp.content, "html.parser")
        
        # Look for results table (common pattern in INPI portal)
        table = soup.find("table", class_=["results", "tabla-marcas", "table"])
        
        if not table:
            logger.debug(f"No results table found for '{variant}'")
            return []
        
        rows = table.find_all("tr")
        
        for row in rows[1:]:  # Skip header
            cols = row.find_all("td")
            if len(cols) < 5:
                continue
            
            try:
                denominacion = cols[0].get_text(strip=True)
                tipo = cols[1].get_text(strip=True) if len(cols) > 1 else ""
                clase_str = cols[2].get_text(strip=True) if len(cols) > 2 else ""
                estado = cols[3].get_text(strip=True) if len(cols) > 3 else ""
                titular = cols[4].get_text(strip=True) if len(cols) > 4 else ""
                vencimiento = cols[5].get_text(strip=True) if len(cols) > 5 else ""
                
                try:
                    clase = int(clase_str)
                except ValueError:
                    continue
                
                # Normalize estado
                estado_code = None
                for key, code in ESTADO_MAP.items():
                    if key in estado.lower():
                        estado_code = code
                        break
                
                result = {
                    "denominacion": denominacion,
                    "tipo": tipo,
                    "clase": clase,
                    "estado": estado,
                    "estado_code": estado_code or "tramite",
                    "titulares": titular,
                    "fecha_vencimiento": vencimiento if vencimiento != "-" else None,
                    "acta": f"{denominacion}_{clase}_{int(time.time())}",  # Generate unique ID
                }
                
                results.append(result)
                
            except Exception as e:
                logger.debug(f"Error parsing row: {e}")
                continue
        
        logger.info(f"Found {len(results)} results via HTML scrape for '{variant}'")
        
    except Exception as e:
        logger.error(f"HTML scrape failed: {e}")
    
    return _filter_by_classes(results, classes)


def _parse_api_results(api_results: List) -> List[Dict]:
    """Parse results from INPI API JSON response."""
    
    results = []
    
    for item in api_results:
        try:
            result = {
                "denominacion": item.get("denominacion") or item.get("name") or "",
                "tipo": item.get("tipo") or "",
                "clase": int(item.get("clase") or item.get("class") or 0),
                "estado": item.get("estado") or item.get("status") or "En trámite",
                "estado_code": _map_estado_code(item.get("estado") or ""),
                "titulares": item.get("titulares") or item.get("holder") or "",
                "fecha_vencimiento": item.get("fecha_vencimiento") or item.get("expiry") or None,
                "acta": item.get("acta") or f"{item.get('denominacion')}_{item.get('clase')}",
            }
            results.append(result)
        except Exception as e:
            logger.debug(f"Error parsing API result: {e}")
            continue
    
    return results


def _map_estado_code(estado: str) -> str:
    """Map estado string to code."""
    
    estado_lower = estado.lower()
    
    for key, code in ESTADO_MAP.items():
        if key in estado_lower:
            return code
    
    return "tramite"


def _filter_by_classes(results: List[Dict], classes: List[int]) -> List[Dict]:
    """Filter results by selected Nice classes."""
    
    if not classes:
        return results
    
    return [r for r in results if r.get("clase") in classes]


# Rate limiting helper
def batch_search(variants: List[str], classes: List[int], delay: float = 1.0) -> Dict[str, List[Dict]]:
    """
    Search multiple variants with rate limiting.
    
    Args:
        variants: List of trademark variants
        classes: List of INPI classes
        delay: Delay between requests in seconds
    
    Returns:
        Dict mapping variant -> results
    """
    
    all_results = {}
    
    for i, variant in enumerate(variants):
        if i > 0:
            time.sleep(delay)
        
        try:
            results = search_inpi(variant, classes)
            all_results[variant] = results
        except Exception as e:
            logger.error(f"Batch search error for '{variant}': {e}")
            all_results[variant] = []
    
    return all_results
