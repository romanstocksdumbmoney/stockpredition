const fs = require("fs");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

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
const LINE_JITTER = 0.9;
const OVAL_JITTER = 0.9;
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
      thickness: thickness * (0.9 + rand() * 0.4),
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
  drawSketchOval(page, 290, 296, 18, 20);
  drawCentrosome(page, 252, 338);
  drawCentrosome(page, 326, 338);
  drawSketchLine(page, 256, 333, 281, 309, 0.75, 1);
  drawSketchLine(page, 322, 333, 299, 309, 0.75, 1);
  drawChromosomeX(page, 278, 305, 7, geneA);
  drawChromosomeX(page, 304, 305, 7, genea);
  drawChromosomeX(page, 278, 284, 7, geneB);
  drawChromosomeX(page, 304, 284, 7, geneb);
  drawHandText(page, font, "A", 268, 314, 8, 2, geneA);
  drawHandText(page, font, "a", 312, 313, 8, 2, genea);
  drawHandText(page, font, "B", 268, 271, 8, 2, geneB);
  drawHandText(page, font, "b", 312, 272, 8, 2, geneb);

  // Metaphase
  drawSketchOval(page, 430, 296, 18, 20);
  drawCentrosome(page, 390, 296);
  drawCentrosome(page, 470, 296);
  const mx = [414, 425, 436, 447];
  [geneA, genea, geneB, geneb].forEach((c, i) => drawChromosomeX(page, mx[i], 296, 6.5, c));
  drawSketchLine(page, 390, 296, 414, 296, 0.9, 1);
  drawSketchLine(page, 470, 296, 447, 296, 0.9, 1);
  drawSketchLine(page, 390, 296, 425, 296, 0.6, 1);
  drawSketchLine(page, 470, 296, 436, 296, 0.6, 1);
  drawHandText(page, font, "A", 405, 270, 8, 2, geneA);
  drawHandText(page, font, "a", 418, 270, 8, 2, genea);
  drawHandText(page, font, "B", 432, 270, 8, 2, geneB);
  drawHandText(page, font, "b", 445, 270, 8, 2, geneb);

  // Anaphase
  drawSketchOval(page, 548, 296, 18, 20);
  drawCentrosome(page, 507, 296);
  drawCentrosome(page, 589, 296);
  drawSketchLine(page, 510, 296, 526, 304, 0.75, 1);
  drawSketchLine(page, 510, 296, 538, 286, 0.75, 1);
  drawSketchLine(page, 586, 296, 558, 304, 0.75, 1);
  drawSketchLine(page, 586, 296, 570, 286, 0.75, 1);
  drawChromosomeI(page, 526, 304, 7, geneA);
  drawChromosomeI(page, 526, 286, 7, geneA);
  drawChromosomeI(page, 538, 304, 7, geneB);
  drawChromosomeI(page, 538, 286, 7, geneB);
  drawChromosomeI(page, 558, 304, 7, genea);
  drawChromosomeI(page, 558, 286, 7, genea);
  drawChromosomeI(page, 570, 304, 7, geneb);
  drawChromosomeI(page, 570, 286, 7, geneb);
  drawHandText(page, font, "A", 519, 318, 8, 2, geneA);
  drawHandText(page, font, "B", 532, 318, 8, 2, geneB);
  drawHandText(page, font, "a", 559, 318, 8, 2, genea);
  drawHandText(page, font, "b", 572, 318, 8, 2, geneb);

  // Daughter cells area
  drawSketchOval(page, 145, 122, 16, 13);
  drawSketchOval(page, 228, 122, 16, 13);
  drawChromosomeI(page, 133, 129, 5, geneA);
  drawChromosomeI(page, 141, 129, 5, genea);
  drawChromosomeI(page, 149, 129, 5, geneB);
  drawChromosomeI(page, 157, 129, 5, geneb);
  drawChromosomeI(page, 216, 129, 5, geneA);
  drawChromosomeI(page, 224, 129, 5, genea);
  drawChromosomeI(page, 232, 129, 5, geneB);
  drawChromosomeI(page, 240, 129, 5, geneb);
  drawHandText(page, font, "A", 122, 100, 8, 2, geneA);
  drawHandText(page, font, "a", 134, 100, 8, 2, genea);
  drawHandText(page, font, "B", 146, 100, 8, 2, geneB);
  drawHandText(page, font, "b", 158, 100, 8, 2, geneb);
  drawHandText(page, font, "A", 205, 100, 8, 2, geneA);
  drawHandText(page, font, "a", 217, 100, 8, 2, genea);
  drawHandText(page, font, "B", 229, 100, 8, 2, geneB);
  drawHandText(page, font, "b", 241, 100, 8, 2, geneb);

  // Telophase bubble
  drawSketchOval(page, 670, 132, 18, 15);
  drawSketchOval(page, 662, 132, 6, 5);
  drawSketchOval(page, 678, 132, 6, 5);
  drawChromosomeI(page, 652, 136, 4.5, geneA);
  drawChromosomeI(page, 658, 136, 4.5, geneB);
  drawChromosomeI(page, 682, 136, 4.5, genea);
  drawChromosomeI(page, 688, 136, 4.5, geneb);
}

function drawMeiosisLabelPage(page, font) {
  // Draw one large prophase I style diagram with labels on page 2
  drawSketchOval(page, 210, 250, 72, 58);
  drawCentrosome(page, 122, 311);
  drawCentrosome(page, 296, 311);
  drawSketchLine(page, 128, 307, 176, 266, 0.75, 1);
  drawSketchLine(page, 289, 307, 240, 238, 0.75, 1);

  drawChromosomeX(page, 176, 266, 9, geneA);
  drawChromosomeX(page, 194, 266, 9, genea);
  drawChromosomeX(page, 222, 238, 9, geneB);
  drawChromosomeX(page, 240, 238, 9, geneb);
  drawSketchLine(page, 182, 272, 188, 260, 0.8, 2);
  drawSketchLine(page, 228, 244, 234, 232, 0.8, 2);

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
  const top = [
    { x: 180, y: 490, type: "proI" },
    { x: 292, y: 490, type: "metaI" },
    { x: 436, y: 490, type: "anaI" },
    { x: 580, y: 490, type: "teloI" },
  ];

  top.forEach(({ x, y, type }) => {
    drawSketchOval(page, x, y, 14, 14);
    if (type === "proI") {
      drawChromosomeX(page, x - 5, y + 3, 4.5, geneA);
      drawChromosomeX(page, x + 5, y + 3, 4.5, genea);
      drawChromosomeX(page, x - 5, y - 7, 4.5, geneB);
      drawChromosomeX(page, x + 5, y - 7, 4.5, geneb);
      drawSketchLine(page, x - 2, y + 8, x + 2, y - 4, 0.7, 1);
    } else if (type === "metaI") {
      const vx = [x - 7, x - 2, x + 3, x + 8];
      [geneA, genea, geneB, geneb].forEach((c, i) =>
        drawChromosomeX(page, vx[i], y, 3.8, c)
      );
      drawSketchLine(page, x - 14, y, x + 14, y, 0.65, 1);
    } else if (type === "anaI") {
      drawChromosomeX(page, x - 8, y + 2, 4, geneA);
      drawChromosomeX(page, x - 2, y - 5, 4, geneB);
      drawChromosomeX(page, x + 8, y + 2, 4, genea);
      drawChromosomeX(page, x + 14, y - 5, 4, geneb);
    } else {
      drawSketchOval(page, x - 6, y, 5, 4);
      drawSketchOval(page, x + 6, y, 5, 4);
      drawChromosomeX(page, x - 6, y + 1, 3.2, geneA);
      drawChromosomeX(page, x - 3, y - 3, 3.2, geneB);
      drawChromosomeX(page, x + 6, y + 1, 3.2, genea);
      drawChromosomeX(page, x + 9, y - 3, 3.2, geneb);
    }
  });

  // Middle row
  drawSketchOval(page, 95, 335, 14, 14); // anaphase II
  drawChromosomeI(page, 90, 339, 4, geneA);
  drawChromosomeI(page, 90, 331, 4, geneB);
  drawChromosomeI(page, 100, 339, 4, geneA);
  drawChromosomeI(page, 100, 331, 4, geneB);

  drawSketchOval(page, 352, 335, 14, 14); // metaphase II
  drawChromosomeX(page, 348, 335, 3.8, genea);
  drawChromosomeX(page, 356, 335, 3.8, geneb);
  drawSketchLine(page, 342, 335, 362, 335, 0.65, 1);

  drawSketchOval(page, 565, 335, 14, 14); // prophase II
  drawChromosomeX(page, 560, 339, 4, genea);
  drawChromosomeX(page, 570, 331, 4, geneb);

  // Bottom row
  drawSketchOval(page, 95, 190, 14, 12); // telophase II
  drawSketchOval(page, 90, 190, 4, 3.5);
  drawSketchOval(page, 100, 190, 4, 3.5);
  drawChromosomeI(page, 90, 190, 2.5, genea);
  drawChromosomeI(page, 100, 190, 2.5, geneb);

  // Daughter cells
  drawSketchOval(page, 648, 190, 10, 10);
  drawSketchOval(page, 684, 190, 10, 10);
  drawSketchOval(page, 720, 190, 10, 10);
  drawSketchOval(page, 756, 190, 10, 10);
  drawChromosomeI(page, 648, 190, 2.8, geneA);
  drawChromosomeI(page, 684, 190, 2.8, geneB);
  drawChromosomeI(page, 720, 190, 2.8, genea);
  drawChromosomeI(page, 756, 190, 2.8, geneb);
  drawHandText(page, font, "4 haploid", 677, 158, 8.5);
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
  const output = "/workspace/Kami_Completed_Handdrawn_Worksheet.pdf";

  const src = fs.readFileSync(input);
  const pdf = await PDFDocument.load(src);
  pdf.registerFontkit(fontkit);
  const fontBytes = fs.readFileSync(
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
  );
  const font = await pdf.embedFont(fontBytes, { subset: true });
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
