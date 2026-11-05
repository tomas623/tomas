// ZIP mínimo sin compresión, para armar .docx (y otros ZIP) de prueba.
const zlib = require('node:zlib');

function zip(entradas) {
  const locales = []; const central = []; let offset = 0;
  for (const [nombre, contenido] of Object.entries(entradas)) {
    const n = Buffer.from(nombre); const d = Buffer.from(contenido); const crc = zlib.crc32(d);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    locales.push(lh, n, d);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, n);
    offset += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(entradas).length, 8);
  fin.writeUInt16LE(Object.keys(entradas).length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, cd, fin]);
}

const CT = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const docx = () => zip({ '[Content_Types].xml': CT, 'word/document.xml': '<w:document/>' });
const docm = () => zip({ '[Content_Types].xml': CT, 'word/document.xml': '<w:document/>', 'word/vbaProject.bin': 'macro' });
const xlsx = () => zip({ '[Content_Types].xml': CT, 'xl/workbook.xml': '<workbook/>' });

module.exports = { zip, docx, docm, xlsx };
