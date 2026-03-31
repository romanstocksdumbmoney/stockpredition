const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const pen = rgb(0.12, 0.12, 0.12);
const geneA = rgb(0.13, 0.36, 0.92); // A blue
const geneB = rgb(0.53, 0.25, 0.8);  // B purple
const genea = rgb(0.87, 0.2, 0.2);   // a red
const geneb = rgb(0.14, 0.62, 0.24); // b green
const FONT_SCALE = 1.25;
const DRAW_SCALE = 1.22;

function line(page, x1, y1, x2, y2, w = 1.2, color = pen) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color, opacity: 0.98 });
}

function circle(page, cx, cy, r, w = 1.0, color = pen) {
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: color, borderWidth: w, opacity: 0.98 });
}

function text(page, font, s, x, y, size = 10, color = pen) {
  page.drawText(s, { x, y, size: size * FONT_SCALE, font, color });
}

function drawX(page, cx, cy, size, color) {
  const s = size * DRAW_SCALE;
  line(page, cx - s, cy - s, cx + s, cy + s, 1.35, color);
  line(page, cx - s, cy + s, cx + s, cy - s, 1.35, color);
}

function drawChromatid(page, cx, cy, size, color) {
  const s = size * DRAW_SCALE;
  const cap = 1.2 * DRAW_SCALE;
  line(page, cx, cy - s, cx, cy + s, 1.35, color);
  line(page, cx - cap, cy - s, cx + cap, cy - s, 1.05, color);
  line(page, cx - cap, cy + s, cx + cap, cy + s, 1.05, color);
}

function drawFourXGrid(page, cx, cy, size = 6.5) {
  const dx = 8 * DRAW_SCALE;
  const dy = 7 * DRAW_SCALE;
  drawX(page, cx - dx, cy + dy, size, geneA);
  drawX(page, cx + dx, cy + dy, size, genea);
  drawX(page, cx - dx, cy - dy, size, geneB);
  drawX(page, cx + dx, cy - dy, size, geneb);
}

function drawFourChromatidsRow(page, cx, cy, size = 5.5) {
  const dx1 = 9 * DRAW_SCALE;
  const dx2 = 3 * DRAW_SCALE;
  drawChromatid(page, cx - dx1, cy, size, geneA);
  drawChromatid(page, cx - dx2, cy, size, geneB);
  drawChromatid(page, cx + dx2, cy, size, genea);
  drawChromatid(page, cx + dx1, cy, size, geneb);
}

function drawMitosisPage(page) {
  // Verified large stage-circle centers on page 1
  const pro = { x: 298, y: 298 };
  const meta = { x: 482, y: 298 };
  const ana = { x: 654, y: 298 };

  // Prophase
  circle(page, pro.x, pro.y, 22, 1.0);
  drawFourXGrid(page, pro.x, pro.y, 7);

  // Metaphase
  circle(page, meta.x, meta.y, 22, 1.0);
  drawX(page, meta.x - 10, meta.y, 6, geneA);
  drawX(page, meta.x - 3, meta.y, 6, genea);
  drawX(page, meta.x + 4, meta.y, 6, geneB);
  drawX(page, meta.x + 11, meta.y, 6, geneb);
  line(page, meta.x - 16, meta.y, meta.x + 16, meta.y, 1.0, pen);

  // Anaphase
  circle(page, ana.x, ana.y, 22, 1.0);
  drawChromatid(page, ana.x - 10, ana.y + 1, 6, geneA);
  drawChromatid(page, ana.x - 3, ana.y + 1, 6, geneB);
  drawChromatid(page, ana.x + 4, ana.y + 1, 6, genea);
  drawChromatid(page, ana.x + 11, ana.y + 1, 6, geneb);

  // Telophase in peanut (one nucleus centered per lobe)
  circle(page, 548, 140, 11, 1.0);
  circle(page, 612, 140, 11, 1.0);
  drawFourChromatidsRow(page, 548, 140, 3.1);
  drawFourChromatidsRow(page, 612, 140, 3.1);

  // Daughter cells (centered)
  circle(page, 114, 123, 17, 1.0);
  circle(page, 261, 123, 17, 1.0);
  drawFourChromatidsRow(page, 114, 123, 4.3);
  drawFourChromatidsRow(page, 261, 123, 4.3);
}

function drawMeiosisLabelPage(_page, _font) {
  // Intentionally left blank per user request:
  // remove extra drawing from this page.
}

function drawMeiosisPhasesPage(page) {
  // Detected centers from template circles (page 3)
  const proI = { x: 182, y: 498 };
  const metaI = { x: 333, y: 498 };
  const anaI = { x: 473, y: 498 };
  const teloILeft = { x: 596, y: 488 };
  const teloIRight = { x: 666, y: 488 };

  // Top row
  circle(page, proI.x, proI.y, 18, 1.0);
  drawFourXGrid(page, proI.x, proI.y, 6.5);

  circle(page, metaI.x, metaI.y, 18, 1.0);
  drawX(page, metaI.x - 10, metaI.y, 5.5, geneA);
  drawX(page, metaI.x - 3, metaI.y, 5.5, genea);
  drawX(page, metaI.x + 4, metaI.y, 5.5, geneB);
  drawX(page, metaI.x + 11, metaI.y, 5.5, geneb);
  line(page, metaI.x - 16, metaI.y, metaI.x + 16, metaI.y, 1.0, pen);

  circle(page, anaI.x, anaI.y, 18, 1.0);
  drawX(page, anaI.x - 9, anaI.y + 4, 5.5, geneA);
  drawX(page, anaI.x - 2, anaI.y - 4, 5.5, geneB);
  drawX(page, anaI.x + 4, anaI.y + 4, 5.5, genea);
  drawX(page, anaI.x + 11, anaI.y - 4, 5.5, geneb);

  // Telophase I (both circles in peanut)
  circle(page, teloILeft.x, teloILeft.y, 14, 1.0);
  circle(page, teloIRight.x, teloIRight.y, 14, 1.0);
  drawFourChromatidsRow(page, teloILeft.x, teloILeft.y, 3.4);
  drawFourChromatidsRow(page, teloIRight.x, teloIRight.y, 3.4);

  // Middle row pair circles
  const a2L = { x: 101, y: 334 }, a2R = { x: 209, y: 334 };
  const m2L = { x: 349, y: 334 }, m2R = { x: 457, y: 334 };
  const p2L = { x: 587, y: 324 }, p2R = { x: 710, y: 334 };

  circle(page, a2L.x, a2L.y, 17, 1.0);
  circle(page, a2R.x, a2R.y, 17, 1.0);
  drawFourChromatidsRow(page, a2L.x, a2L.y, 4.8);
  drawFourChromatidsRow(page, a2R.x, a2R.y, 4.8);

  circle(page, m2L.x, m2L.y, 17, 1.0);
  circle(page, m2R.x, m2R.y, 17, 1.0);
  drawFourXGrid(page, m2L.x, m2L.y, 5.2);
  drawFourXGrid(page, m2R.x, m2R.y, 5.2);
  line(page, m2L.x - 15, m2L.y, m2L.x + 15, m2L.y, 0.95, pen);
  line(page, m2R.x - 15, m2R.y, m2R.x + 15, m2R.y, 0.95, pen);

  circle(page, p2L.x, p2L.y, 17, 1.0);
  circle(page, p2R.x, p2R.y, 17, 1.0);
  drawFourXGrid(page, p2L.x, p2L.y, 5.2);
  drawFourXGrid(page, p2R.x, p2R.y, 5.2);

  // Telophase II in bottom-left peanut (move deeper inside peanut lobes)
  circle(page, 118, 176, 11, 1.0);
  circle(page, 258, 176, 11, 1.0);
  drawFourChromatidsRow(page, 118, 176, 3.0);
  drawFourChromatidsRow(page, 258, 176, 3.0);

  // Daughter Cells 2x2 circles (detected exact centers)
  const g1 = { x: 479, y: 199 }, g2 = { x: 587, y: 199 }, g3 = { x: 479, y: 112 }, g4 = { x: 587, y: 112 };
  // each gamete with two chromosomes (mixed combos for variety)
  drawChromatid(page, g1.x - 3, g1.y + 2, 3.8, geneA); drawChromatid(page, g1.x + 3, g1.y + 2, 3.8, geneB);
  drawChromatid(page, g2.x - 3, g2.y + 2, 3.8, genea); drawChromatid(page, g2.x + 3, g2.y + 2, 3.8, geneb);
  drawChromatid(page, g3.x - 3, g3.y + 2, 3.8, geneA); drawChromatid(page, g3.x + 3, g3.y + 2, 3.8, geneb);
  drawChromatid(page, g4.x - 3, g4.y + 2, 3.8, genea); drawChromatid(page, g4.x + 3, g4.y + 2, 3.8, geneB);
}

function fillSummaryTable(page4, page5, page6, font) {
  // Page 4
  text(page4, font, "body cells", 220, 430, 10);
  text(page4, font, "sex cells", 447, 432, 10);
  text(page4, font, "(gametes)", 447, 420, 10);

  text(page4, font, "1 division ->", 220, 375, 10);
  text(page4, font, "2 identical", 220, 363, 10);
  text(page4, font, "2n cells", 220, 351, 10);
  text(page4, font, "2 divisions ->", 447, 375, 10);
  text(page4, font, "4 different", 447, 363, 10);
  text(page4, font, "n cells", 447, 351, 10);

  text(page4, font, "2 diploid", 220, 282, 10);
  text(page4, font, "cells", 220, 270, 10);
  text(page4, font, "4 haploid", 447, 282, 10);
  text(page4, font, "cells", 447, 270, 10);

  text(page4, font, "PMAT once", 220, 236, 10);
  text(page4, font, "PMAT I +", 447, 238, 10);
  text(page4, font, "PMAT II", 447, 226, 10);

  text(page4, font, "asexual", 220, 146, 10);
  text(page4, font, "sexual", 447, 146, 10);

  // Page 5
  text(page5, font, "yes", 220, 542, 10);
  text(page5, font, "no", 447, 542, 10);

  text(page5, font, "once", 220, 470, 10);
  text(page5, font, "(after telophase)", 220, 458, 10);
  text(page5, font, "twice", 447, 470, 10);
  text(page5, font, "(after I and II)", 447, 458, 10);

  text(page5, font, "1 time", 220, 386, 10);
  text(page5, font, "2 times", 447, 386, 10);

  text(page5, font, "stays 2n", 220, 276, 10);
  text(page5, font, "(46 in humans)", 220, 264, 10);
  text(page5, font, "in pairs", 220, 252, 10);
  text(page5, font, "halves to n", 447, 276, 10);
  text(page5, font, "(23 in humans)", 447, 264, 10);
  text(page5, font, "individual", 447, 252, 10);

  text(page5, font, "growth +", 220, 148, 10);
  text(page5, font, "repair", 220, 136, 10);
  text(page5, font, "variation +", 447, 148, 10);
  text(page5, font, "proper # for", 447, 136, 10);
  text(page5, font, "fertilization", 447, 124, 10);

  // Page 6: BOTH boxes filled
  text(page6, font, "Mitosis: body cells = 46", 220, 542, 10);
  text(page6, font, "Meiosis: sex cells = 23", 220, 530, 10);

  text(page6, font, "Mitosis keeps chromosome", 447, 542, 10);
  text(page6, font, "number the same (2n).", 447, 530, 10);
  text(page6, font, "Meiosis halves it to n", 447, 518, 10);
  text(page6, font, "for gametes.", 447, 506, 10);

  text(page6, font, "Nondisjunction = chromosomes do not separate right.", 60, 338, 9.2);
  text(page6, font, "In meiosis I homologous chromosomes can fail to split;", 60, 326, 9.2);
  text(page6, font, "meiosis II sister chromatids can fail to split.", 60, 314, 9.2);
  text(page6, font, "This makes gametes with extra or missing chromosomes.", 60, 302, 9.2);
  text(page6, font, "Down syndrome: trisomy 21 (47 total).", 60, 290, 9.2);
  text(page6, font, "Turner syndrome: monosomy X (45, X).", 60, 278, 9.2);
  text(page6, font, "These change gene dosage, so development can differ:", 60, 266, 9.2);
  text(page6, font, "Down can include learning delays and heart risks;", 60, 254, 9.2);
  text(page6, font, "Turner can include short stature and ovarian issues.", 60, 242, 9.2);
}

async function main() {
  const input = "/workspace/source_worksheet.pdf";
  const output = "/workspace/Kami_Completed_Handdrawn_Worksheet_v13.pdf";

  const src = fs.readFileSync(input);
  const pdf = await PDFDocument.load(src);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  drawMitosisPage(pages[0]);
  drawMeiosisLabelPage(pages[1], font);
  drawMeiosisPhasesPage(pages[2]);
  fillSummaryTable(pages[3], pages[4], pages[5], font);

  const out = await pdf.save();
  fs.writeFileSync(output, out);
  console.log(`Wrote ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
