// توليد مقال "نداء" للترويج — ملف Word عربي RTL احترافي
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  ExternalHyperlink, Footer, PageNumber, LevelFormat,
} = require("docx");
const fs = require("fs");

// ---------------------------------------------------------------- palette ----
const P = {
  primary: "4C1D95",   // بنفسجي غامق للعناوين (هوية نداء)
  body: "1F2937",      // رمادي داكن للنص
  secondary: "6B7280", // رمادي للبيانات الوصفية
  accent: "6D28D9",    // بنفسجي للإبراز
  light: "F5F3FF",     // خلفية فاتحة لرأس الجدول
  border: "C4B5FD",    // حدود الجدول
  link: "4F46E5",      // لون الروابط
};

const AR_FONT = { ascii: "Arial", hAnsi: "Arial", cs: "Arial" };

// ---------------------------------------------------------------- helpers ----
/** Run عربي RTL */
function ar(text, opts = {}) {
  return new TextRun({
    text,
    font: AR_FONT,
    rightToLeft: true,
    size: opts.size ?? 24,
    sizeComplexScript: opts.size ?? 24,
    bold: opts.bold ?? false,
    boldComplexScript: opts.bold ?? false,
    italics: opts.italics ?? false,
    color: opts.color ?? P.body,
  });
}

/** فقرة نص عادية (مضبوطة الاتجاه، مبررة) */
function body(runs, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 0, after: 160, line: 400 },
    children: runs,
    ...opts,
  });
}

/** عنوان قسم */
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    bidirectional: true,
    alignment: AlignmentType.START,
    spacing: { before: 360, after: 160, line: 400 },
    children: [ar(text, { size: 28, bold: true, color: P.primary })],
  });
}

/** عنصر قائمة نقطية */
function bullet(runs) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.START,
    bullet: { level: 0 },
    spacing: { before: 0, after: 80, line: 400 },
    children: runs,
  });
}

/** عنصر قائمة مرقمة */
function step(runs) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.START,
    numbering: { reference: "steps-link", level: 0 },
    spacing: { before: 0, after: 100, line: 400 },
    children: runs,
  });
}

/** خلية جدول */
function cell(runs, opts = {}) {
  return new TableCell({
    children: [new Paragraph({
      bidirectional: opts.rtl ?? true,
      alignment: opts.align ?? AlignmentType.START,
      spacing: { before: 0, after: 0, line: 320 },
      children: runs,
    })],
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
    margins: { top: 80, bottom: 80, left: 140, right: 140 },
    width: { size: opts.width, type: WidthType.PERCENTAGE },
  });
}

/** رابط خارجي داخل فقرة RTL */
function link(url, display) {
  return new ExternalHyperlink({
    link: url,
    children: [new TextRun({
      text: display ?? url,
      font: AR_FONT,
      size: 24,
      sizeComplexScript: 24,
      color: P.link,
      underline: { type: "single", color: P.link },
      style: "Hyperlink",
    })],
  });
}

// ---------------------------------------------------------------- content ----
const children = [];

// — العنوان —
children.push(new Paragraph({
  bidirectional: true,
  alignment: AlignmentType.CENTER,
  spacing: { before: 120, after: 120, line: 460, lineRule: "atLeast" },
  children: [
    ar("نداء: عندما يتصل بك إيجنتك الذكي", { size: 40, bold: true, color: P.primary }),
    new TextRun({ text: "", break: 1 }),
    ar("بمكالمة صوتية حقيقية", { size: 40, bold: true, color: P.primary }),
  ],
}));

children.push(new Paragraph({
  bidirectional: true,
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 80, line: 360 },
  children: [ar("مكالمة حية تقرأ لك نتيجة مهمتك، تسمعك وترد عليك — مجاني ومفتوح المصدر", { size: 24, color: P.secondary })],
}));

children.push(new Paragraph({
  bidirectional: true,
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 60, line: 320 },
  children: [ar("بقلم: حسين شعبان — NextGen AI", { size: 20, color: P.secondary })],
}));

// فاصل تحت الترويسة (حد فقرة — ليس خطوط نصية)
children.push(new Paragraph({
  spacing: { before: 0, after: 280 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: P.border } },
  children: [new TextRun({ text: "", size: 2 })],
}));

// — المقدمة —
children.push(h1("لماذا نداء؟"));
children.push(body([
  ar("أصبحت وكلاء الذكاء الاصطناعي اليوم قادرين على تنفيذ مهام كاملة نيابة عنك: يبحثون، يكتبون، يرسلون، ويجدولون أعمالًا تعمل في الخلفية. لكن هناك تفصيلًا واحدًا يفسد التجربة غالبًا: النتيجة لا تصل إليك إلا إذا فتحت التطبيق وتابعت المحادثة بنفسك. كثير من المهام تنتهي وأنت منشغل، فتبقى النتيجة مدفونة داخل الشات دون أن تلاحظها، أو تتأخر ساعات حتى تتذكر أن تسأل عنها."),
]));
children.push(body([
  ar("هنا يأتي "),
  ar("«نداء»", { bold: true, color: P.accent }),
  ar(" — مشروع مجاني ومفتوح المصدر من NextGen AI. الفكرة بسيطة ومباشرة: عندما ينهي إيجنتك مهمة مجدولة، يستدعي نداء فتظهر على هاتفك "),
  ar("شاشة مكالمة كاملة برنة حقيقية", { bold: true }),
  ar(". ترد، فتسمع ملخصًا واضحًا لما تم بصوت طبيعي، ثم تتكلم مع الإيجنت مباشرة: تسأله، توجهه، وتطلب منه تنفيذ خطوات جديدة وسط المكالمة نفسها — من دون أن تلمس لوحة المفاتيح."),
]));

// — كيف يعمل —
children.push(h1("كيف يعمل نداء؟"));
children.push(body([
  ar("الربط يتم مرة واحدة فقط. تفتح نداء من المتصفح، تسجل دخولك ببريدك الإلكتروني، وتضع مفاتيح حسابك على "),
  ar("Fish Audio", { bold: true }),
  ar("، ثم تنسخ كود الربط الجاهز وتلصقه في إيجنتك — سواء كان ChatGPT أو Claude أو Cursor أو أي أداة تدعم بروتوكول "),
  ar("MCP", { bold: true }),
  ar(" (Model Context Protocol)، المعيار المفتوح الذي أصبحت أدوات الذكاء الاصطناعي الكبرى تدعمه للاتصال بالخدمات الخارجية."),
]));
children.push(body([
  ar("من هذه اللحظة يصبح نداء أداة بين يدي إيجنتك: عند اكتمال أي مهمة ينادي بها، فيرن هاتفك فورًا. وعند ردك تفتح قناة صوتية حية يقرأ الإيجنت فيها ملخص المهمة، ويستمع لك ويرد عليك في نفس اللحظة. ولو أنجز خطوة جديدة أثناء المكالمة — أرسل بريدًا، نفذ أمرًا، جلب نتيجة — يصلك التحديث "),
  ar("منطوقًا بصوت وسط الحديث", { bold: true }),
  ar(" مباشرة، بدل أن تخرج من المكالمة لتقرأ رسالة."),
]));

// — المميزات —
children.push(h1("المميزات في نقاط"));
[
  [ar("مكالمة صوتية حية", { bold: true }), ar(" برنة وشاشة مكالمة كاملة لحظة انتهاء المهمة — تجربة أقرب إلى مكالمة عادية منها إلى إشعار.")],
  [ar("محادثة ثنائية الاتجاه", { bold: true }), ar(": الإيجنت يسمع كلامك ويرد عليك فورًا داخل المكالمة.")],
  [ar("تحديثات مباشرة منطوقة", { bold: true }), ar(" كلما أنجز الإيجنت خطوة جديدة أثناء المكالمة.")],
  [ar("متوافق مع كل الوكلاء", { bold: true }), ar(": ChatGPT وClaude Desktop وCursor وn8n وأي أداة تدعم MCP.")],
  [ar("واجهة REST كاملة", { bold: true }), ar(" لأي سكربت أو أداة أتمتة لا تدعم MCP.")],
  [ar("إشعارات فورية (Web Push)", { bold: true }), ar(" حتى لو كانت صفحة نداء مقفولة.")],
  [ar("دخول بلا كلمات مرور", { bold: true }), ar(": بريد إلكتروني فقط، والجهاز يظل مسجلاً.")],
  [ar("تطبيق PWA", { bold: true }), ar(" يثبت على الشاشة الرئيسية ويعمل كتطبيق عادي على الموبايل.")],
  [ar("عزل كامل لكل مستخدم", { bold: true }), ar(": حسابك ومفتاحك ومكالماتك وإعداداتك — لا أحد يراها غيرك.")],
].forEach((runs) => children.push(bullet(runs)));

// — خطوات الربط —
children.push(h1("اربط إيجنتك في دقائق"));
children.push(step([ar("افتح نداء من متصفحك وسجل الدخول ببريدك الإلكتروني فقط — من أول مرة يُنشأ حسابك، والجهاز يظل مسجلاً.")]));
children.push(step([ar("من بطاقة «إعدادات Fish Audio» داخل التطبيق، أدخل الـ API Key ومعرّف الوكيل (Agent ID) الخاصين بحسابك على fish.audio — القيم تُحفظ لحسابك إنت وحده.")]));
children.push(step([ar("انسخ كود الربط الجاهز من بطاقة «اربط إيجنتك» — يوجد كونفج مخصص لكل من ChatGPT وClaude Desktop وCursor وصيغة MCP العامة، جاهز للنسخ بضغطة واحدة.")]));
children.push(step([ar("الصق الكود في إعدادات إيجنتك، واطلب منه استخدام أداة notify_task_complete فور انتهاء أي مهمة مجدولة، ثم البقاء في حلقة wait_for_call_updates حتى انتهاء المكالمة.")]));
children.push(step([ar("انتهى — من أول مهمة تكتمل بعد ذلك، سيكون هاتفك هو الذي يرن.")]));

// — للمطورين —
children.push(h1("للمطورين: ما تحت الغطاء"));
children.push(body([
  ar("النواة خادم MCP كامل على المسار "),
  ar("/api/mcp", { bold: true }),
  ar(" يكشف أربع أدوات واضحة، مصممة حول نمط «النبض»: الإيجنت يستدعي المكالمة ثم يبقى في حلقة استماع طويلة حتى تنتهي، وكل ما يقوله المستخدم وسط المكالمة يصله فورًا ليُنفذه بأدواته الخاصة ثم يرد عليه صوتيًا. بهذا الشكل تتحول المكالمة إلى جلسة عمل حقيقية بين المستخدم والإيجنت، لا مجرد إشعار مسموع."),
]));

const tableBorder = { style: BorderStyle.SINGLE, size: 4, color: P.border };
children.push(new Paragraph({
  bidirectional: true,
  keepNext: true,
  alignment: AlignmentType.START,
  spacing: { before: 120, after: 100 },
  children: [ar("الأدوات الأربع التي يكشفها خادم MCP:", { size: 22, bold: true, color: P.body })],
}));
children.push(new Table({
  visuallyRightToLeft: true,
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top: tableBorder, bottom: tableBorder,
    left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
    insideHorizontal: tableBorder,
    insideVertical: { style: BorderStyle.NONE },
  },
  rows: [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        cell([ar("الأداة", { size: 21, bold: true, color: P.primary })], { width: 32, fill: P.light }),
        cell([ar("الوظيفة", { size: 21, bold: true, color: P.primary })], { width: 68, fill: P.light }),
      ],
    }),
    new TableRow({ cantSplit: true, children: [
      cell([new TextRun({ text: "notify_task_complete", font: AR_FONT, size: 20, sizeComplexScript: 20, color: P.accent })], { width: 32, rtl: false }),
      cell([ar("بدء مكالمة صوتية للمستخدم فور اكتمال المهمة، وترجع معرّف المكالمة.", { size: 21 })], { width: 68 }),
    ]}),
    new TableRow({ cantSplit: true, children: [
      cell([new TextRun({ text: "wait_for_call_updates", font: AR_FONT, size: 20, sizeComplexScript: 20, color: P.accent })], { width: 32, rtl: false }),
      cell([ar("استماع طويل (long-poll) يرجع كلام المستخدم وحالة المكالمة — نبضة تبقى الإيجنت داخل المكالمة.", { size: 21 })], { width: 68 }),
    ]}),
    new TableRow({ cantSplit: true, children: [
      cell([new TextRun({ text: "send_call_update", font: AR_FONT, size: 20, sizeComplexScript: 20, color: P.accent })], { width: 32, rtl: false }),
      cell([ar("إرسال تحديث جديد يُنطق صوتيًا وسط المكالمة ويظهر كفقرة بنفسجية على الشاشة.", { size: 21 })], { width: 68 }),
    ]}),
    new TableRow({ cantSplit: true, children: [
      cell([new TextRun({ text: "get_call_status", font: AR_FONT, size: 20, sizeComplexScript: 20, color: P.accent })], { width: 32, rtl: false }),
      cell([ar("الاستعلام عن حالة مكالمة بعينها أو استعراض آخر المكالمات.", { size: 21 })], { width: 68 }),
    ]}),
  ],
}));

children.push(body([
  ar("ومن غير MCP؟ واجهة REST كاملة تفتح الباب لأي أداة أو سكربت: "),
  ar("POST /api/calls", { bold: true }),
  ar(" لبدء مكالمة، ثم "),
  ar("GET /api/calls/{id}/updates?since=0&wait=25", { bold: true }),
  ar(" للاستماع الطويل لكلام المستخدم، وأخيرًا "),
  ar("POST /api/calls/{id}/updates", { bold: true }),
  ar(" لإرسال تحديث يُقال صوتيًا. كل الندوات محمية بمفتاح API يُنشأ لكل حساب على حدة."),
], { spacing: { before: 200, after: 160, line: 400 } }));

children.push(body([
  ar("وعلى صعيد الخصوصية: إعدادات Fish Audio (المفتاح ومعرّف الوكيل ورقم الهاتف) تُحفظ في قاعدة البيانات مرتبطة بحسابك وحده، وكل مكالمة تُسجل باسم مالكها، ولا يرى أي مستخدم مكالمات مستخدم آخر."),
]));

// — مجاني ومفتوح المصدر —
children.push(h1("مجاني ومفتوح المصدر"));
children.push(body([
  ar("نداء ليس خدمة مدفوعة ولا تجربة محدودة: "),
  ar("كل الكود متاح على GitHub", { bold: true }),
  ar(" — شغّله على استضافتك، عدّله بما يناسبك، وانشر نسختك الخاصة. المساهمات والمقترحات مرحب بها دائمًا. ولو أفادك المشروع وحقق لك وقتًا، يمكنك دعم استمرار التطوير بالتبرع عبر PayPal بأي مبلغ يناسبك — التبرع اختياري تمامًا، لكنه يصنع فرقًا حقيقيًا لمشروع فردي."),
]));

// — الروابط —
children.push(h1("الروابط"));
[
  [ar("الكود المفتوح على GitHub: "), link("https://github.com/nidaa-ai/mcp")],
  [ar("الشروحات والفيديوهات على YouTube: "), link("https://www.youtube.com/@NextGen_AI2023")],
  [ar("قناة تليجرام للمتابعة والأخبار: "), link("https://t.me/nextgenai2023")],
  [ar("دعم المشروع عبر PayPal: "), link("mailto:hussainandshabaan@gmail.com", "hussainandshabaan@gmail.com")],
].forEach((runs) => children.push(bullet(runs)));

// — الخاتمة —
children.push(body([
  ar("جرّب نداء اليوم: اربطه بإيجنتك مرة واحدة، ودعه هو من يلاحقك بالنتائج — بمكالمة لا يمكن تفويتها.", { bold: true, color: P.accent }),
], { spacing: { before: 240, after: 240, line: 400 } }));

children.push(new Paragraph({
  bidirectional: true,
  alignment: AlignmentType.CENTER,
  spacing: { before: 120, after: 0, line: 360 },
  border: { top: { style: BorderStyle.SINGLE, size: 4, color: P.border } },
  children: [ar("حسين شعبان — مؤسس NextGen AI وصاحب مشروع نداء", { size: 22, color: P.secondary })],
}));

// ---------------------------------------------------------------- document ----
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: AR_FONT, size: 24, color: P.body },
        paragraph: { spacing: { line: 400 } },
      },
      heading1: {
        run: { font: AR_FONT, size: 28, bold: true, color: P.primary },
        paragraph: { spacing: { before: 360, after: 160, line: 400 } },
      },
    },
    characterStyles: [{
      id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont",
      run: { color: P.link, underline: { type: "single", color: P.link } },
    }],
  },
  numbering: {
    config: [{
      reference: "steps-link",
      levels: [{
        level: 0,
        format: LevelFormat.DECIMAL,
        text: "%1.",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 620, hanging: 360 } } },
      }],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT], font: AR_FONT, size: 18, color: P.secondary })],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = "/home/z/my-project/download/مقال-نداء-للنشر.docx";
  fs.writeFileSync(out, buf);
  console.log("WRITTEN", out, buf.length, "bytes");
});
