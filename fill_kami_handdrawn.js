const fs = require("fs");
const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");

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

function j(v, amt) {
  return v + (rand() - 0.5) * amt;
}

function drawSketchLine(page, x1, y1, x2, y2, thickness = 1.05, passes = 2) {
  for (let i = 0; i < passes; i += 1) {
    page.drawLine({
      start: { x: j(x1, 1.6), y: j(y1, 1.6) },
      end: { x: j(x2, 1.6), y: j(y2, 1.6) },
      thickness: thickness * (0.9 + rand() * 0.4),
      color: pen,
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
      x: cx + Math.cos(t) * (rx + (rand() - 0.5) * 2),
      y: cy + Math.sin(t) * (ry + (rand() - 0.5) * 2),
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

function drawChromosomeX(page, cx, cy, size) {
  drawSketchLine(page, cx - size, cy - size, cx + size, cy + size, 1.15, 2);
  drawSketchLine(page, cx - size, cy + size, cx + size, cy - size, 1.15, 2);
}

function drawChromosomeI(page, cx, cy, size) {
  drawSketchLine(page, cx, cy - size, cx, cy + size, 1.2, 2);
}

function drawCentrosome(page, x, y) {
  drawSketchLine(page, x - 6, y, x + 6, y, 1, 2);
  drawSketchLine(page, x, y - 6, x, y + 6, 1, 2);
  drawSketchLine(page, x - 4, y - 4, x + 4, y + 4, 0.9, 1);
  drawSketchLine(page, x - 4, y + 4, x + 4, y - 4, 0.9, 1);
}

function drawHandText(page, font, text, x, y, size = 10, lineGap = 2) {
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    page.drawText(line, {
      x: j(x, 1.8),
      y: j(y - idx * (size + lineGap), 1),
      size: size + (rand() - 0.5) * 0.5,
      font,
      color: pen,
      rotate: degrees((rand() - 0.5) * 2.3),
    });
  });
}

function drawMitosisPage(page, font) {
  // Prophase
  drawSketchOval(page, 290, 296, 45, 52);
  drawSketchOval(page, 290, 296, 26, 30);
  drawCentrosome(page, 252, 338);
  drawCentrosome(page, 326, 338);
  drawChromosomeX(page, 278, 305, 7);
  drawChromosomeX(page, 304, 305, 7);
  drawChromosomeX(page, 278, 284, 7);
  drawChromosomeX(page, 304, 284, 7);
  drawHandText(page, font, "A", 268, 314, 8);
  drawHandText(page, font, "a", 312, 313, 8);
  drawHandText(page, font, "B", 268, 271, 8);
  drawHandText(page, font, "b", 312, 272, 8);

  // Metaphase
  drawSketchOval(page, 430, 296, 45, 52);
  drawCentrosome(page, 390, 296);
  drawCentrosome(page, 470, 296);
  const mx = [414, 425, 436, 447];
  mx.forEach((x) => drawChromosomeX(page, x, 296, 6.5));
  drawSketchLine(page, 390, 296, 414, 296, 0.9, 2);
  drawSketchLine(page, 470, 296, 447, 296, 0.9, 2);
  drawHandText(page, font, "A  a  B  b", 404, 270, 8);

  // Anaphase
  drawSketchOval(page, 548, 296, 45, 52);
  drawCentrosome(page, 507, 296);
  drawCentrosome(page, 589, 296);
  [526, 538].forEach((x) => {
    drawChromosomeI(page, x, 304, 7);
    drawChromosomeI(page, x, 286, 7);
  });
  [558, 570].forEach((x) => {
    drawChromosomeI(page, x, 304, 7);
    drawChromosomeI(page, x, 286, 7);
  });
  drawHandText(page, font, "A B", 520, 318, 8);
  drawHandText(page, font, "a b", 560, 318, 8);

  // Daughter cells area
  drawSketchOval(page, 145, 122, 40, 36);
  drawSketchOval(page, 228, 122, 40, 36);
  drawSketchOval(page, 145, 122, 19, 16);
  drawSketchOval(page, 228, 122, 19, 16);
  drawChromosomeI(page, 137, 128, 5);
  drawChromosomeI(page, 147, 128, 5);
  drawChromosomeI(page, 224, 128, 5);
  drawChromosomeI(page, 234, 128, 5);
  drawHandText(page, font, "A a B b", 124, 100, 8);
  drawHandText(page, font, "A a B b", 206, 100, 8);

  // Telophase bubble
  drawSketchOval(page, 670, 132, 44, 38);
  drawSketchOval(page, 656, 132, 15, 13);
  drawSketchOval(page, 684, 132, 15, 13);
  drawChromosomeI(page, 654, 134, 4.5);
  drawChromosomeI(page, 686, 134, 4.5);
  drawSketchLine(page, 670, 94, 670, 170, 0.8, 1);
}

function drawMeiosisLabelPage(page, font) {
  // Draw one large prophase I style diagram with labels on page 2
  drawSketchOval(page, 210, 250, 105, 85);
  drawCentrosome(page, 122, 311);
  drawCentrosome(page, 296, 311);

  drawChromosomeX(page, 176, 266, 9);
  drawChromosomeX(page, 194, 266, 9);
  drawChromosomeX(page, 222, 238, 9);
  drawChromosomeX(page, 240, 238, 9);
  drawSketchLine(page, 182, 272, 188, 260, 0.8, 2);
  drawSketchLine(page, 228, 244, 234, 232, 0.8, 2);

  drawHandText(page, font, "homologous pair", 74, 265, 8.5);
  drawSketchLine(page, 145, 264, 166, 266, 0.8, 1);
  drawHandText(page, font, "sister\nchromatids", 76, 232, 8.5);
  drawSketchLine(page, 145, 236, 172, 257, 0.8, 1);
  drawHandText(page, font, "genes", 308, 255, 8.5);
  drawSketchLine(page, 302, 250, 246, 243, 0.8, 1);
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
    drawSketchOval(page, x, y, 38, 38);
    if (type === "proI") {
      drawChromosomeX(page, x - 10, y + 5, 6.5);
      drawChromosomeX(page, x + 5, y + 5, 6.5);
      drawChromosomeX(page, x - 2, y - 14, 6.5);
      drawChromosomeX(page, x + 13, y - 14, 6.5);
      drawSketchLine(page, x - 6, y + 11, x, y - 1, 0.8, 2);
    } else if (type === "metaI") {
      [x - 12, x - 2, x + 8, x + 18].forEach((vx) =>
        drawChromosomeX(page, vx, y, 5.5)
      );
    } else if (type === "anaI") {
      drawChromosomeX(page, x - 14, y, 6);
      drawChromosomeX(page, x - 1, y - 7, 6);
      drawChromosomeX(page, x + 14, y, 6);
      drawChromosomeX(page, x + 27, y - 7, 6);
    } else {
      drawSketchOval(page, x - 10, y, 12, 11);
      drawSketchOval(page, x + 12, y, 12, 11);
      drawChromosomeX(page, x - 10, y, 4.5);
      drawChromosomeX(page, x + 12, y, 4.5);
    }
  });

  // Middle row
  drawSketchOval(page, 95, 335, 38, 38); // anaphase II
  drawChromosomeI(page, 83, 343, 6);
  drawChromosomeI(page, 83, 327, 6);
  drawChromosomeI(page, 108, 343, 6);
  drawChromosomeI(page, 108, 327, 6);

  drawSketchOval(page, 352, 335, 38, 38); // metaphase II
  [342, 352, 362].forEach((x) => drawChromosomeX(page, x, 335, 5.5));

  drawSketchOval(page, 565, 335, 38, 38); // prophase II
  drawChromosomeX(page, 555, 345, 6);
  drawChromosomeX(page, 573, 327, 6);

  // Bottom row
  drawSketchOval(page, 95, 190, 38, 34); // telophase II
  drawSketchOval(page, 85, 190, 11, 9);
  drawSketchOval(page, 106, 190, 11, 9);
  drawChromosomeI(page, 85, 190, 4);
  drawChromosomeI(page, 106, 190, 4);

  // Daughter cells
  drawSketchOval(page, 648, 190, 24, 24);
  drawSketchOval(page, 686, 190, 24, 24);
  drawSketchOval(page, 724, 190, 24, 24);
  drawSketchOval(page, 762, 190, 24, 24);
  drawChromosomeI(page, 648, 190, 4);
  drawChromosomeI(page, 686, 190, 4);
  drawChromosomeI(page, 724, 190, 4);
  drawChromosomeI(page, 762, 190, 4);
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
  const font = await pdf.embedFont(StandardFonts.CourierOblique);
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
