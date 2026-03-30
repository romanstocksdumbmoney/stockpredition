const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(13013);
const pen = rgb(0.12, 0.12, 0.12);
const geneA = rgb(0.13, 0.36, 0.92); // dad: blue
const geneB = rgb(0.53, 0.25, 0.8); // dad: purple
const genea = rgb(0.87, 0.2, 0.2); // mom: red
const geneb = rgb(0.14, 0.62, 0.24); // mom: green
const LINE_JITTER = 0;
const OVAL_JITTER = 0;
const TEXT_JITTER_X = 0;
const TEXT_JITTER_Y = 0;

function j(v, amt) {
  return v + (rand() - 0.5) * amt;
}

function drawSketchLine(
  page,
  x1,
  y1,
  x2,
  y2,
  thickness = 1.05,
  passes = 2,
  color = pen
) {
  for (let i = 0; i < passes; i += 1) {
    page.drawLine({
      start: { x: j(x1, LINE_JITTER), y: j(y1, LINE_JITTER) },
      end: { x: j(x2, LINE_JITTER), y: j(y2, LINE_JITTER) },
      thickness,
      color,
      opacity: 0.95,
    });
  }
}

function drawSketchOval(page, cx, cy, rx, ry) {
  const points = [];
  const n = 36;
  for (let i = 0; i <= n; i += 1) {
    const t = (Math.PI * 2 * i) / n;
    points.push({
      x: cx + Math.cos(t) * (rx + (rand() - 0.5) * OVAL_JITTER),
      y: cy + Math.sin(t) * (ry + (rand() - 0.5) * OVAL_JITTER),
    });
  }
  for (let p = 0; p < 2; p += 1) {
    for (let i = 1; i < points.length; i += 1) {
      drawSketchLine(
        page,
        points[i - 1].x,
        points[i - 1].y,
        points[i].x,
        points[i].y,
        0.95,
        1
      );
    }
  }
}

function drawChromosomeX(page, cx, cy, size, color = pen) {
  drawSketchLine(page, cx - size, cy - size, cx + size, cy + size, 1.15, 2, color);
  drawSketchLine(page, cx - size, cy + size, cx + size, cy - size, 1.15, 2, color);
}

function drawChromosomeI(page, cx, cy, size, color = pen) {
  drawSketchLine(page, cx, cy - size, cx, cy + size, 1.2, 2, color);
}

function drawCentrosome(page, x, y) {
  drawSketchLine(page, x - 6, y, x + 6, y, 1, 2);
  drawSketchLine(page, x, y - 6, x, y + 6, 1, 2);
  drawSketchLine(page, x - 4, y - 4, x + 4, y + 4, 0.9, 1);
  drawSketchLine(page, x - 4, y + 4, x + 4, y - 4, 0.9, 1);
}

function drawCleanNucleus(page, cx, cy, rx, ry) {
  page.drawEllipse({
    x: cx - rx,
    y: cy - ry,
    xScale: rx,
    yScale: ry,
    borderColor: pen,
    borderWidth: 0.9,
    opacity: 0.95,
  });
}

function drawHandText(page, font, text, x, y, size = 10, lineGap = 2, color = pen) {
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    page.drawText(line, {
      x: j(x, TEXT_JITTER_X),
      y: j(y - idx * (size + lineGap), TEXT_JITTER_Y),
      size,
      font,
      color,
    });
  });
}

function drawMitosisPage(page, font) {
  // Prophase
  drawCleanNucleus(page, 292, 295, 15, 16);
  drawCentrosome(page, 254, 336);
  drawCentrosome(page, 330, 336);
  drawSketchLine(page, 259, 332, 284, 307, 0.75, 1);
  drawSketchLine(page, 325, 332, 302, 307, 0.75, 1);
  drawChromosomeX(page, 284, 302, 6, geneA);
  drawChromosomeX(page, 300, 302, 6, genea);
  drawChromosomeX(page, 284, 287, 6, geneB);
  drawChromosomeX(page, 300, 287, 6, geneb);
  drawHandText(page, font, "A", 276, 309, 8, 2, geneA);
  drawHandText(page, font, "a", 307, 309, 8, 2, genea);
  drawHandText(page, font, "B", 276, 272, 8, 2, geneB);
  drawHandText(page, font, "b", 307, 272, 8, 2, geneb);

  // Metaphase
  drawCleanNucleus(page, 430, 296, 16, 16);
  drawCentrosome(page, 390, 296);
  drawCentrosome(page, 470, 296);
  const mx = [420, 427, 434, 441];
  [geneA, genea, geneB, geneb].forEach((c, i) => drawChromosomeX(page, mx[i], 296, 4.8, c));
  drawSketchLine(page, 390, 296, 420, 296, 0.8, 1);
  drawSketchLine(page, 470, 296, 441, 296, 0.8, 1);
  drawHandText(page, font, "A", 416, 276, 7.5, 2, geneA);
  drawHandText(page, font, "a", 425, 276, 7.5, 2, genea);
  drawHandText(page, font, "B", 434, 276, 7.5, 2, geneB);
  drawHandText(page, font, "b", 443, 276, 7.5, 2, geneb);

  // Anaphase
  drawCleanNucleus(page, 548, 296, 16, 16);
  drawCentrosome(page, 507, 296);
  drawCentrosome(page, 589, 296);
  drawSketchLine(page, 509, 296, 530, 302, 0.75, 1);
  drawSketchLine(page, 509, 296, 536, 290, 0.75, 1);
  drawSketchLine(page, 587, 296, 560, 302, 0.75, 1);
  drawSketchLine(page, 587, 296, 566, 290, 0.75, 1);
  drawChromosomeI(page, 530, 302, 5.2, geneA);
  drawChromosomeI(page, 536, 290, 5.2, geneB);
  drawChromosomeI(page, 560, 302, 5.2, genea);
  drawChromosomeI(page, 566, 290, 5.2, geneb);
  drawHandText(page, font, "A", 525, 311, 7.5, 2, geneA);
  drawHandText(page, font, "B", 534, 311, 7.5, 2, geneB);
  drawHandText(page, font, "a", 559, 311, 7.5, 2, genea);
  drawHandText(page, font, "b", 568, 311, 7.5, 2, geneb);

  // Daughter cells area
  drawCleanNucleus(page, 145, 122, 11, 9);
  drawCleanNucleus(page, 228, 122, 11, 9);
  drawChromosomeI(page, 139, 124, 3.2, geneA);
  drawChromosomeI(page, 145, 124, 3.2, genea);
  drawChromosomeI(page, 151, 124, 3.2, geneB);
  drawChromosomeI(page, 157, 124, 3.2, geneb);
  drawChromosomeI(page, 222, 124, 3.2, geneA);
  drawChromosomeI(page, 228, 124, 3.2, genea);
  drawChromosomeI(page, 234, 124, 3.2, geneB);
  drawChromosomeI(page, 240, 124, 3.2, geneb);

  // Telophase bubble
  drawCleanNucleus(page, 664, 132, 6, 5);
  drawCleanNucleus(page, 676, 132, 6, 5);
  drawChromosomeI(page, 662, 134, 2.8, geneA);
  drawChromosomeI(page, 666, 134, 2.8, geneB);
  drawChromosomeI(page, 674, 134, 2.8, genea);
  drawChromosomeI(page, 678, 134, 2.8, geneb);
}

function drawMeiosisLabelPage(page, font) {
  // Draw one large prophase I style diagram with labels on page 2
  drawCleanNucleus(page, 210, 250, 55, 45);
  drawCentrosome(page, 122, 311);
  drawCentrosome(page, 296, 311);
  drawSketchLine(page, 128, 307, 176, 266, 0.75, 1);
  drawSketchLine(page, 289, 307, 240, 238, 0.75, 1);

  drawChromosomeX(page, 176, 266, 9, geneA);
  drawChromosomeX(page, 194, 266, 9, genea);
  drawChromosomeX(page, 222, 238, 9, geneB);
  drawChromosomeX(page, 240, 238, 9, geneb);
  drawSketchLine(page, 182, 272, 188, 260, 0.8, 1);
  drawSketchLine(page, 228, 244, 234, 232, 0.8, 1);

  drawHandText(page, font, "homologous pair", 74, 265, 8.5);
  drawSketchLine(page, 145, 264, 166, 266, 0.8, 1);
  drawHandText(page, font, "sister\nchromatids", 76, 232, 8.5);
  drawSketchLine(page, 145, 236, 172, 257, 0.8, 1);
  drawHandText(page, font, "genes", 308, 255, 8.5);
  drawSketchLine(page, 302, 250, 246, 243, 0.8, 1);
  drawHandText(page, font, "A", 169, 278, 8, 2, geneA);
  drawHandText(page, font, "a", 194, 278, 8, 2, genea);
  drawHandText(page, font, "B", 218, 250, 8, 2, geneB);
  drawHandText(page, font, "b", 242, 250, 8, 2, geneb);
  drawHandText(page, font, "spindle fibers", 300, 215, 8.5);
  drawSketchLine(page, 296, 212, 248, 302, 0.8, 1);
  drawHandText(page, font, "centrosome", 78, 304, 8.5);
  drawSketchLine(page, 152, 303, 122, 311, 0.8, 1);
  drawHandText(page, font, "centrioles", 300, 302, 8.5);
  drawSketchLine(page, 300, 299, 296, 311, 0.8, 1);
  drawHandText(page, font, "nuclear membrane", 118, 160, 8.5);
  drawSketchLine(page, 216, 170, 244, 192, 0.8, 1);
}

function drawMeiosisPhasesPage(page, font) {
  // Top row: Meiosis I
  drawCleanNucleus(page, 180, 490, 14, 14); // Prophase I
  drawChromosomeX(page, 174, 495, 5, geneA);
  drawChromosomeX(page, 186, 495, 5, genea);
  drawChromosomeX(page, 174, 484, 5, geneB);
  drawChromosomeX(page, 186, 484, 5, geneb);
  drawSketchLine(page, 177, 499, 183, 486, 0.7, 1);

  drawCleanNucleus(page, 292, 490, 14, 14); // Metaphase I
  [284, 290, 296, 302].forEach((x, i) => {
    const colors = [geneA, genea, geneB, geneb];
    drawChromosomeX(page, x, 490, 4.3, colors[i]);
  });
  drawSketchLine(page, 276, 490, 308, 490, 0.7, 1);

  drawCleanNucleus(page, 433, 490, 14, 14); // Anaphase I
  drawChromosomeX(page, 425, 493, 4.3, geneA);
  drawChromosomeX(page, 431, 484, 4.3, geneB);
  drawChromosomeX(page, 437, 493, 4.3, genea);
  drawChromosomeX(page, 443, 484, 4.3, geneb);

  // Telophase I has two connected cells; fill both sides
  drawCleanNucleus(page, 578, 490, 12, 12);
  drawCleanNucleus(page, 642, 490, 12, 12);
  drawCleanNucleus(page, 574, 490, 4, 3.5);
  drawCleanNucleus(page, 582, 490, 4, 3.5);
  drawCleanNucleus(page, 638, 490, 4, 3.5);
  drawCleanNucleus(page, 646, 490, 4, 3.5);
  drawChromosomeI(page, 576, 490, 2.5, geneA);
  drawChromosomeI(page, 584, 490, 2.5, geneB);
  drawChromosomeI(page, 640, 490, 2.5, genea);
  drawChromosomeI(page, 648, 490, 2.5, geneb);

  // Middle row: fill both circles for each stage II block
  // Anaphase II pair
  drawCleanNucleus(page, 97, 335, 14, 14);
  drawCleanNucleus(page, 207, 335, 14, 14);
  drawChromosomeI(page, 90, 340, 4, geneA);
  drawChromosomeI(page, 90, 330, 4, geneB);
  drawChromosomeI(page, 100, 340, 4, geneA);
  drawChromosomeI(page, 100, 330, 4, geneB);
  drawChromosomeI(page, 202, 340, 4, genea);
  drawChromosomeI(page, 202, 330, 4, geneb);
  drawChromosomeI(page, 212, 340, 4, genea);
  drawChromosomeI(page, 212, 330, 4, geneb);

  // Metaphase II pair
  drawCleanNucleus(page, 352, 335, 14, 14);
  drawCleanNucleus(page, 462, 335, 14, 14);
  drawChromosomeX(page, 347, 335, 4.3, geneA);
  drawChromosomeX(page, 357, 335, 4.3, geneB);
  drawChromosomeX(page, 457, 335, 4.3, genea);
  drawChromosomeX(page, 467, 335, 4.3, geneb);
  drawSketchLine(page, 338, 335, 366, 335, 0.65, 1);
  drawSketchLine(page, 448, 335, 476, 335, 0.65, 1);

  // Prophase II pair
  drawCleanNucleus(page, 564, 335, 14, 14);
  drawCleanNucleus(page, 674, 335, 14, 14);
  drawChromosomeX(page, 560, 340, 4.5, geneA);
  drawChromosomeX(page, 570, 330, 4.5, geneB);
  drawChromosomeX(page, 670, 340, 4.5, genea);
  drawChromosomeX(page, 680, 330, 4.5, geneb);

  // Bottom row: Telophase II pair (both cells filled)
  drawCleanNucleus(page, 97, 190, 14, 12);
  drawCleanNucleus(page, 207, 190, 14, 12);
  drawCleanNucleus(page, 92, 190, 4, 3.5);
  drawCleanNucleus(page, 102, 190, 4, 3.5);
  drawCleanNucleus(page, 202, 190, 4, 3.5);
  drawCleanNucleus(page, 212, 190, 4, 3.5);
  drawChromosomeI(page, 90, 190, 2.8, geneA);
  drawChromosomeI(page, 100, 190, 2.8, geneB);
  drawChromosomeI(page, 202, 190, 2.8, genea);
  drawChromosomeI(page, 212, 190, 2.8, geneb);

  // Daughter cells (2x2 blank circles)
  drawChromosomeI(page, 582, 208, 3.4, geneA);
  drawChromosomeI(page, 676, 208, 3.4, geneB);
  drawChromosomeI(page, 582, 112, 3.4, genea);
  drawChromosomeI(page, 676, 112, 3.4, geneb);
}

function fillSummaryTable(page4, page5, page6, font) {
  // Page 4 rows
  drawHandText(page4, font, "body cells", 220, 430, 10);
  drawHandText(page4, font, "sex cells\n(gametes)", 447, 432, 10);

  drawHandText(page4, font, "1 division ->\n2 identical\n2n cells", 220, 375, 10);
  drawHandText(page4, font, "2 divisions ->\n4 different\nn cells", 447, 375, 10);

  drawHandText(page4, font, "2 diploid\ncells", 220, 282, 10);
  drawHandText(page4, font, "4 haploid\ncells", 447, 282, 10);

  drawHandText(page4, font, "PMAT once", 220, 236, 10);
  drawHandText(page4, font, "PMAT I +\nPMAT II", 447, 238, 10);

  drawHandText(page4, font, "asexual", 220, 146, 10);
  drawHandText(page4, font, "sexual", 447, 146, 10);

  // Page 5 rows
  drawHandText(page5, font, "yes", 220, 542, 10);
  drawHandText(page5, font, "no", 447, 542, 10);

  drawHandText(page5, font, "once\n(after telophase)", 220, 470, 10);
  drawHandText(page5, font, "twice\n(after I and II)", 447, 470, 10);

  drawHandText(page5, font, "1 time", 220, 386, 10);
  drawHandText(page5, font, "2 times", 447, 386, 10);

  drawHandText(page5, font, "stays 2n\n(46 in humans)\nin pairs", 220, 276, 10);
  drawHandText(page5, font, "halves to n\n(23 in humans)\nindividual", 447, 276, 10);

  drawHandText(page5, font, "growth +\nrepair", 220, 148, 10);
  drawHandText(page5, font, "variation +\nproper # for\nfertilization", 447, 148, 10);

  // Page 6
  drawHandText(
    page6,
    font,
    "Mitosis: body cells = 46\nMeiosis: sex cells = 23",
    220,
    542,
    10
  );

  drawHandText(
    page6,
    font,
    "Nondisjunction = chromosomes do not separate right.\nIn meiosis I homologous chromosomes can fail to split;\nmeiosis II sister chromatids can fail to split.\nThis makes gametes with extra or missing chromosomes.\nDown syndrome: trisomy 21 (47 total).\nTurner syndrome: monosomy X (45, X).\nThese change gene dosage, so development can differ:\nDown can include learning delays and heart risks;\nTurner can include short stature and ovarian issues.",
    60,
    338,
    9.2,
    2
  );
}

async function main() {
  const input = "/workspace/source_worksheet.pdf";
  const output = "/workspace/Kami_Completed_Handdrawn_Worksheet_v5.pdf";

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
