const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const pen = rgb(0.12, 0.12, 0.12);
const geneA = rgb(0.13, 0.36, 0.92); // A blue
const geneB = rgb(0.53, 0.25, 0.8);  // B purple
const genea = rgb(0.87, 0.2, 0.2);   // a red
const geneb = rgb(0.14, 0.62, 0.24); // b green

function line(page, x1, y1, x2, y2, w = 1, color = pen) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color, opacity: 0.95 });
}

function circle(page, cx, cy, r, w = 1, color = pen) {
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: color, borderWidth: w, opacity: 0.95 });
}

function text(page, font, s, x, y, size = 9, color = pen) {
  page.drawText(s, { x, y, size, font, color });
}

function xChrom(page, cx, cy, size, color) {
  line(page, cx - size, cy - size, cx + size, cy + size, 1.4, color);
  line(page, cx - size, cy + size, cx + size, cy - size, 1.4, color);
}

function iChrom(page, cx, cy, size, color) {
  line(page, cx, cy - size, cx, cy + size, 1.4, color);
}

function drawFourX(page, cx, cy, size = 7) {
  xChrom(page, cx - 8, cy + 7, size, geneA);
  xChrom(page, cx + 8, cy + 7, size, genea);
  xChrom(page, cx - 8, cy - 7, size, geneB);
  xChrom(page, cx + 8, cy - 7, size, geneb);
}

function drawFourI(page, cx, cy, size = 6) {
  iChrom(page, cx - 9, cy + 2, size, geneA);
  iChrom(page, cx - 3, cy + 2, size, geneB);
  iChrom(page, cx + 3, cy + 2, size, genea);
  iChrom(page, cx + 9, cy + 2, size, geneb);
}

function drawMitosisPage(page) {
  // Centers from phase labels on page 1
  const pro = { x: 288, y: 304 };
  const meta = { x: 427, y: 304 };
  const ana = { x: 541, y: 304 };

  // Prophase (large and centered)
  circle(page, pro.x, pro.y, 19, 1);
  drawFourX(page, pro.x, pro.y, 7);

  // Metaphase
  circle(page, meta.x, meta.y, 19, 1);
  xChrom(page, meta.x - 10, meta.y, 6, geneA);
  xChrom(page, meta.x - 3, meta.y, 6, genea);
  xChrom(page, meta.x + 4, meta.y, 6, geneB);
  xChrom(page, meta.x + 11, meta.y, 6, geneb);
  line(page, meta.x - 15, meta.y, meta.x + 15, meta.y, 1, pen);

  // Anaphase
  circle(page, ana.x, ana.y, 19, 1);
  iChrom(page, ana.x - 10, ana.y + 2, 6, geneA);
  iChrom(page, ana.x - 3, ana.y + 2, 6, geneB);
  iChrom(page, ana.x + 4, ana.y + 2, 6, genea);
  iChrom(page, ana.x + 11, ana.y + 2, 6, geneb);

  // Telophase (inside peanut, right half)
  circle(page, 664, 143, 8, 1);
  circle(page, 684, 143, 8, 1);
  iChrom(page, 661, 145, 3.2, geneA);
  iChrom(page, 667, 145, 3.2, geneB);
  iChrom(page, 681, 145, 3.2, genea);
  iChrom(page, 687, 145, 3.2, geneb);

  // Daughter cells (centered in each big circle)
  circle(page, 145, 122, 14, 1);
  circle(page, 228, 122, 14, 1);
  drawFourI(page, 145, 122, 4.2);
  drawFourI(page, 228, 122, 4.2);
}

function drawMeiosisLabelPage(page, font) {
  // Compact, centered in the demonstration region only
  circle(page, 208, 260, 42, 1);
  xChrom(page, 192, 272, 10, geneA);
  xChrom(page, 208, 272, 10, genea);
  xChrom(page, 224, 248, 10, geneB);
  xChrom(page, 240, 248, 10, geneb);
  line(page, 198, 278, 203, 266, 1, pen);
  line(page, 230, 254, 235, 242, 1, pen);

  text(page, font, "homologous pair", 74, 265, 8.5);
  line(page, 145, 264, 182, 267, 0.9, pen);
  text(page, font, "sister chromatids", 76, 232, 8.5);
  line(page, 145, 236, 171, 257, 0.9, pen);
  text(page, font, "genes", 308, 255, 8.5);
  line(page, 302, 250, 252, 243, 0.9, pen);
  text(page, font, "spindle fibers", 300, 215, 8.5);
  text(page, font, "centrosome", 78, 304, 8.5);
  text(page, font, "centrioles", 300, 302, 8.5);
  text(page, font, "nuclear membrane", 118, 160, 8.5);
}

function drawMeiosisPhasesPage(page) {
  // All drawings are centered and similarly sized inside the main circles.

  // Top row (I)
  circle(page, 180, 490, 16, 1); // Prophase I
  drawFourX(page, 180, 490, 6);

  circle(page, 292, 490, 16, 1); // Metaphase I
  xChrom(page, 282, 490, 5.2, geneA);
  xChrom(page, 289, 490, 5.2, genea);
  xChrom(page, 296, 490, 5.2, geneB);
  xChrom(page, 303, 490, 5.2, geneb);
  line(page, 276, 490, 308, 490, 0.9, pen);

  circle(page, 434, 490, 16, 1); // Anaphase I
  xChrom(page, 425, 493, 5.2, geneA);
  xChrom(page, 431, 484, 5.2, geneB);
  xChrom(page, 437, 493, 5.2, genea);
  xChrom(page, 443, 484, 5.2, geneb);

  // Telophase I in peanut (both halves)
  circle(page, 724, 490, 12, 1);
  circle(page, 834, 490, 12, 1);
  drawFourI(page, 724, 490, 3.4);
  drawFourI(page, 834, 490, 3.4);

  // Middle row (pair circles for II)
  circle(page, 97, 335, 16, 1);   // Anaphase II left
  drawFourI(page, 97, 335, 5.1);
  circle(page, 207, 335, 16, 1);  // Anaphase II right
  drawFourI(page, 207, 335, 5.1);

  circle(page, 352, 335, 16, 1);  // Metaphase II left
  drawFourX(page, 352, 335, 5.2);
  line(page, 338, 335, 366, 335, 0.9, pen);
  circle(page, 462, 335, 16, 1);  // Metaphase II right
  drawFourX(page, 462, 335, 5.2);
  line(page, 448, 335, 476, 335, 0.9, pen);

  circle(page, 564, 335, 16, 1);  // Prophase II left
  drawFourX(page, 564, 335, 5.2);
  circle(page, 674, 335, 16, 1);  // Prophase II right
  drawFourX(page, 674, 335, 5.2);

  // Bottom row Telophase II
  circle(page, 97, 190, 16, 1);
  circle(page, 207, 190, 16, 1);
  circle(page, 90, 190, 5, 1);
  circle(page, 100, 190, 5, 1);
  circle(page, 200, 190, 5, 1);
  circle(page, 210, 190, 5, 1);
  iChrom(page, 90, 190, 2.8, geneA);
  iChrom(page, 100, 190, 2.8, geneB);
  iChrom(page, 200, 190, 2.8, genea);
  iChrom(page, 210, 190, 2.8, geneb);

  // Daughter cells 2x2 (centered in each blank circle)
  drawFourI(page, 582, 208, 3.9);
  drawFourI(page, 676, 208, 3.9);
  drawFourI(page, 582, 112, 3.9);
  drawFourI(page, 676, 112, 3.9);
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
  const output = "/workspace/Kami_Completed_Handdrawn_Worksheet_v7.pdf";

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
