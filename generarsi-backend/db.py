"""
GenerarSí — Base de datos (Etapa 2)
-----------------------------------
Guarda los "casos" (problemas y propuestas del barrio) y los "aportes"
(lo que otros vecinos suman a cada caso).

Usa PostgreSQL, que Railway ofrece. La dirección de la base se lee de la
variable de entorno DATABASE_URL — NUNCA va escrita acá.

Los datos de contacto (email y teléfono) se guardan pero NO se muestran
en las listas públicas: son datos personales.
"""

import os
import logging

import psycopg2
import psycopg2.extras

log = logging.getLogger("generarsi.db")

DATABASE_URL = os.environ.get("DATABASE_URL")


def hay_base():
    """¿Está configurada la base de datos?"""
    return bool(DATABASE_URL)


def conectar():
    if not DATABASE_URL:
        raise RuntimeError("No hay base de datos configurada (falta DATABASE_URL).")
    return psycopg2.connect(DATABASE_URL)


ESQUEMA = """
CREATE TABLE IF NOT EXISTS casos (
    id            SERIAL PRIMARY KEY,
    tipo          TEXT NOT NULL,              -- 'problema' o 'propuesta'
    titulo        TEXT NOT NULL,
    descripcion   TEXT NOT NULL,
    barrio        TEXT,                       -- barrio del caso (dónde pasa)
    lat           DOUBLE PRECISION,           -- ubicación en el mapa (opcional)
    lng           DOUBLE PRECISION,
    autor_nombre  TEXT NOT NULL,
    autor_edad    INTEGER,
    autor_barrio  TEXT,
    autor_email   TEXT,                       -- privado, no se muestra
    autor_telefono TEXT,                      -- privado, no se muestra
    estado        TEXT NOT NULL DEFAULT 'publicado',
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aportes (
    id            SERIAL PRIMARY KEY,
    caso_id       INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
    texto         TEXT NOT NULL,
    autor_nombre  TEXT NOT NULL,
    autor_edad    INTEGER,
    autor_barrio  TEXT,
    autor_email   TEXT,                       -- privado, no se muestra
    autor_telefono TEXT,                      -- privado, no se muestra
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def crear_tablas():
    """Crea las tablas si no existen. Es seguro llamarla muchas veces."""
    with conectar() as con:
        with con.cursor() as cur:
            cur.execute(ESQUEMA)
        con.commit()


# --- Casos ---

def crear_caso(d):
    with conectar() as con:
        with con.cursor() as cur:
            cur.execute(
                """INSERT INTO casos
                   (tipo, titulo, descripcion, barrio, lat, lng,
                    autor_nombre, autor_edad, autor_barrio, autor_email, autor_telefono)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   RETURNING id""",
                (d.get("tipo", "propuesta"), d.get("titulo", ""), d.get("descripcion", ""),
                 d.get("barrio"), d.get("lat"), d.get("lng"),
                 d.get("autor_nombre", ""), d.get("autor_edad"), d.get("autor_barrio"),
                 d.get("autor_email"), d.get("autor_telefono")),
            )
            nuevo = cur.fetchone()[0]
        con.commit()
        return nuevo


def listar_casos():
    """Lista pública de casos (SIN email ni teléfono)."""
    with conectar() as con:
        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT c.id, c.tipo, c.titulo, c.descripcion, c.barrio,
                          c.lat, c.lng, c.autor_nombre, c.autor_edad, c.autor_barrio,
                          c.estado, c.creado_en,
                          (SELECT count(*) FROM aportes a WHERE a.caso_id = c.id) AS aportes
                   FROM casos c
                   WHERE c.estado = 'publicado'
                   ORDER BY c.creado_en DESC"""
            )
            return [dict(r) for r in cur.fetchall()]


def obtener_caso(caso_id):
    """Un caso público + sus aportes (SIN datos de contacto)."""
    with conectar() as con:
        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT id, tipo, titulo, descripcion, barrio, lat, lng,
                          autor_nombre, autor_edad, autor_barrio, estado, creado_en
                   FROM casos WHERE id = %s AND estado = 'publicado'""",
                (caso_id,),
            )
            caso = cur.fetchone()
            if not caso:
                return None
            caso = dict(caso)
            cur.execute(
                """SELECT id, texto, autor_nombre, autor_edad, autor_barrio, creado_en
                   FROM aportes WHERE caso_id = %s ORDER BY creado_en ASC""",
                (caso_id,),
            )
            caso["aportes"] = [dict(r) for r in cur.fetchall()]
            return caso


def borrar_caso(caso_id):
    with conectar() as con:
        with con.cursor() as cur:
            cur.execute("DELETE FROM casos WHERE id = %s", (caso_id,))
        con.commit()


# --- Aportes ---

def crear_aporte(caso_id, d):
    with conectar() as con:
        with con.cursor() as cur:
            cur.execute(
                """INSERT INTO aportes
                   (caso_id, texto, autor_nombre, autor_edad, autor_barrio,
                    autor_email, autor_telefono)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)
                   RETURNING id""",
                (caso_id, d.get("texto", ""), d.get("autor_nombre", ""), d.get("autor_edad"),
                 d.get("autor_barrio"), d.get("autor_email"), d.get("autor_telefono")),
            )
            nuevo = cur.fetchone()[0]
        con.commit()
        return nuevo


def borrar_aporte(aporte_id):
    with conectar() as con:
        with con.cursor() as cur:
            cur.execute("DELETE FROM aportes WHERE id = %s", (aporte_id,))
        con.commit()
