"""
Diagnostic: prints raw text samples from a bulletin PDF and shows what the
parser's regexes do (or don't) match. Use when the parser extracts 0 records.

    python diagnose_bulletin.py 5500
"""
import sys
import io
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

from bulk_importer import download_bulletin
from bulletin_parser import RE_ENTRY, RE_TABLE_HEADER, RE_TABLE_ROW


def main(num: int) -> None:
    import pdfplumber

    print(f"\n── Downloading bulletin {num} ──")
    pdf_bytes = download_bulletin(num)
    if not pdf_bytes:
        print("Download failed.")
        return
    print(f"Downloaded {len(pdf_bytes):,} bytes")

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        total = len(pdf.pages)
        print(f"Total pages: {total}")

        wipo_hits = table_hits = row_hits = 0
        # Scan whole bulletin (excluding last 10 admin pages)
        scan_upto = max(1, total - 10)

        # Sample pages at spread-out positions so we see real trademark data,
        # not just the regulatory preamble at the start.
        sample_positions = sorted({
            min(scan_upto - 1, p)
            for p in (30, 60, 120, 250, 400, scan_upto // 2)
        })
        sample_printed = 0

        for i in range(scan_upto):
            try:
                text = pdf.pages[i].extract_text() or ""
            except Exception as e:
                print(f"  page {i+1}: extract error — {e}")
                continue

            if RE_ENTRY.search(text):
                wipo_hits += 1
            if RE_TABLE_HEADER.search(text):
                table_hits += 1
            for line in text.splitlines():
                if RE_TABLE_ROW.match(line.strip()):
                    row_hits += 1

            if i in sample_positions and sample_printed < 4 and text.strip():
                print(f"\n── Raw text from page {i+1} (first 2000 chars) ──")
                print(text[:2000])
                sample_printed += 1

        print(f"\n── Regex summary (all {scan_upto} content pages) ──")
        print(f"  WIPO entries found:      {wipo_hits}")
        print(f"  Table headers found:     {table_hits}")
        print(f"  Table rows that match:   {row_hits}")

        if wipo_hits == 0 and table_hits == 0 and row_hits == 0:
            print("\n⚠  Neither format matches. The bulletin layout may have changed.")
            print("    Paste the 'Raw text' above into the chat so we can adapt the regex.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python diagnose_bulletin.py <bulletin_number>")
        sys.exit(1)
    main(int(sys.argv[1]))
