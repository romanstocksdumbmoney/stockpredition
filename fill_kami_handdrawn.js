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
  line(page, cx - size, cy - size, cx + size, cy + size, 1.3, color);
  line(page, cx - size, cy + size, cx + size, cy - size, 1.3, color);
}

function iChrom(page, cx, cy, size, color) {
  line(page, cx, cy - size, cx, cy + size, 1.3, color);
}

function drawMainCell(page, cx, cy, r = 16) {
  circle(page, cx, cy, r, 1, pen);
}

function drawMitosisPage(page, font) {
  // Prophase (center of first phase circle)
  const p1 = { x: 325, y: 304 };
  drawMainCell(page, p1.x, p1.y, 16);
  xChrom(page, p1.x - 6, p1.y + 4, 5, geneA);
  xChrom(page, p1.x + 6, p1.y + 4, 5, genea);
  xChrom(page, p1.x - 6, p1.y - 6, 5, geneB);
  xChrom(page, p1.x + 6, p1.y - 6, 5, geneb);

  // Metaphase
  const p2 = { x: 540, y: 304 };
  drawMainCell(page, p2.x, p2.y, 16);
  const xs = [p2.x - 8, p2.x - 3, p2.x + 2, p2.x + 7];
  [geneA, genea, geneB, geneb].forEach((c, i) => xChrom(page, xs[i], p2.y, 4.3, c));
  line(page, p2.x - 14, p2.y, p2.x + 14, p2.y, 0.9, pen);

  // Anaphase
  const p3 = { x: 655, y: 304 };
  drawMainCell(page, p3.x, p3.y, 16);
  iChrom(page, p3.x - 6, p3.y + 4, 4.5, geneA);
  iChrom(page, p3.x - 1, p3.y + 4, 4.5, geneB);
  iChrom(page, p3.x + 5, p3.y + 4, 4.5, genea);
  iChrom(page, p3.x + 10, p3.y + 4, 4.5, geneb);

  // Telophase (inside right half of peanut)
  const p4a = { x: 798, y: 143 };
  const p4b = { x: 820, y: 143 };
  drawMainCell(page, p4a.x, p4a.y, 6.5);
  drawMainCell(page, p4b.x, p4b.y, 6.5);
  iChrom(page, p4a.x - 2, p4a.y + 1, 2.5, geneA);
  iChrom(page, p4a.x + 2, p4a.y + 1, 2.5, geneB);
  iChrom(page, p4b.x - 2, p4b.y + 1, 2.5, genea);
  iChrom(page, p4b.x + 2, p4b.y + 1, 2.5, geneb);

  // Daughter cells: centered in each big circle
  const d1 = { x: 176, y: 122 };
  const d2 = { x: 320, y: 122 };
  drawMainCell(page, d1.x, d1.y, 12);
  drawMainCell(page, d2.x, d2.y, 12);
  [d1, d2].forEach((d) => {
    iChrom(page, d.x - 6, d.y + 2, 3.4, geneA);
    iChrom(page, d.x - 1, d.y + 2, 3.4, genea);
    iChrom(page, d.x + 4, d.y + 2, 3.4, geneB);
    iChrom(page, d.x + 9, d.y + 2, 3.4, geneb);
  });
}

function drawMeiosisLabelPage(page, font) {
  // Keep a clean centered prophase-I example in the main diagram area
  const c = { x: 210, y: 250 };
  drawMainCell(page, c.x, c.y, 56);
  xChrom(page, c.x - 24, c.y + 16, 12, geneA);
  xChrom(page, c.x - 4, c.y + 16, 12, genea);
  xChrom(page, c.x + 22, c.y - 10, 12, geneB);
  xChrom(page, c.x + 42, c.y - 10, 12, geneb);

  text(page, font, "homologous pair", 74, 265, 8.5);
  line(page, 145, 264, 182, 267, 0.8, pen);
  text(page, font, "sister", 76, 236, 8.5);
  text(page, font, "chromatids", 76, 226, 8.5);
  line(page, 145, 236, 171, 257, 0.8, pen);
  text(page, font, "genes", 308, 255, 8.5);
  line(page, 302, 250, 252, 243, 0.8, pen);
  text(page, font, "spindle fibers", 300, 215, 8.5);
  line(page, 296, 212, 248, 302, 0.8, pen);
  text(page, font, "centrosome", 78, 304, 8.5);
  text(page, font, "centrioles", 300, 302, 8.5);
  text(page, font, "nuclear membrane", 118, 160, 8.5);
}

function fourInsideCell(page, cx, cy, type = "x") {
  drawMainCell(page, cx, cy, 16);
  if (type === "x") {
    xChrom(page, cx - 6, cy + 4, 5, geneA);
    xChrom(page, cx - 1, cy + 4, 5, geneB);
    xChrom(page, cx + 5, cy + 4, 5, genea);
    xChrom(page, cx + 10, cy + 4, 5, geneb);
  } else {
    iChrom(page, cx - 6, cy + 3, 4.2, geneA);
    iChrom(page, cx - 1, cy + 3, 4.2, geneB);
    iChrom(page, cx + 5, cy + 3, 4.2, genea);
    iChrom(page, cx + 10, cy + 3, 4.2, geneb);
  }
}

function drawMeiosisPhasesPage(page, font) {
  // Use one centered nucleus per stage circle, all same size.
  // Top row
  const proI = { x: 180, y: 490 };
  const metaI = { x: 292, y: 490 };
  const anaI = { x: 436, y: 490 };
  fourInsideCell(page, proI.x, proI.y, "x");

  drawMainCell(page, metaI.x, metaI.y, 16);
  [metaI.x - 8, metaI.x - 3, metaI.x + 2, metaI.x + 7].forEach((x, i) => {
    [geneA, genea, geneB, geneb].forEach((c, j) => {
      if (i === j) xChrom(page, x, metaI.y, 4.3, c);
    });
  });
  line(page, metaI.x - 14, metaI.y, metaI.x + 14, metaI.y, 0.9, pen);

  drawMainCell(page, anaI.x, anaI.y, 16);
  xChrom(page, anaI.x - 8, anaI.y + 3, 4.5, geneA);
  xChrom(page, anaI.x - 2, anaI.y - 5, 4.5, geneB);
  xChrom(page, anaI.x + 4, anaI.y + 3, 4.5, genea);
  xChrom(page, anaI.x + 10, anaI.y - 5, 4.5, geneb);

  // Telophase I in right half of peanut
  const tel1L = { x: 720, y: 490 };
  const tel1R = { x: 830, y: 490 };
  drawMainCell(page, tel1L.x, tel1L.y, 12);
  drawMainCell(page, tel1R.x, tel1R.y, 12);
  iChrom(page, tel1L.x - 2, tel1L.y + 2, 3.2, geneA);
  iChrom(page, tel1L.x + 3, tel1L.y + 2, 3.2, geneB);
  iChrom(page, tel1R.x - 2, tel1R.y + 2, 3.2, genea);
  iChrom(page, tel1R.x + 3, tel1R.y + 2, 3.2, geneb);

  // Middle row pair blocks
  fourInsideCell(page, 97, 335, "i");    // Anaphase II left
  fourInsideCell(page, 207, 335, "i");   // Anaphase II right

  fourInsideCell(page, 352, 335, "x");   // Metaphase II left
  fourInsideCell(page, 462, 335, "x");   // Metaphase II right

  fourInsideCell(page, 564, 335, "x");   // Prophase II left
  fourInsideCell(page, 674, 335, "x");   // Prophase II right

  // Bottom row telophase II (both circles)
  drawMainCell(page, 97, 190, 14);
  drawMainCell(page, 207, 190, 14);
  drawMainCell(page, 90, 190, 5);
  drawMainCell(page, 100, 190, 5);
  drawMainCell(page, 200, 190, 5);
  drawMainCell(page, 210, 190, 5);
  iChrom(page, 90, 190, 2.7, geneA);
  iChrom(page, 100, 190, 2.7, geneB);
  iChrom(page, 200, 190, 2.7, genea);
  iChrom(page, 210, 190, 2.7, geneb);

  // Daughter cells 2x2 centered
  iChrom(page, 582, 208, 3.8, geneA);
  iChrom(page, 676, 208, 3.8, geneB);
  iChrom(page, 582, 112, 3.8, genea);
  iChrom(page, 676, 112, 3.8, geneb);
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

  // Page 6: fill BOTH boxes in that row
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
  const output = "/workspace/Kami_Completed_Handdrawn_Worksheet_v6.pdf";

  const src = fs.readFileSync(input);
  const pdf = await PDFDocument.load(src);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  drawMitosisPage(pages[0], font);
  drawMeiosisLabelPage(pages[1], font);
  drawMeiosisPhasesPage(pages[2], font);
  fillSummaryTable(pages[3], pages[4], pages[5], font);

  const out = await pdf.save();
  fs.writeFileSync(output, out);
  console.log(`Wrote ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
