export type Language = "en" | "th";

export const translations = {
  en: {
    // Header & Navigation
    navExplorer: "Explorer",
    navSql: "SQL",
    navVisualQuery: "Visual Query",
    navErd: "ERD",
    navAdmin: "Admin",
    navImport: "Import",
    navLogs: "Logs",
    navConnections: "Connections",
    navSettings: "Settings",
    switchThemeDark: "Switch to Dark Mode",
    switchThemeLight: "Switch to Light Mode",
    quickSearchPlaceholder: "Quick Search tables, commands, actions...",
    quickSearchInTable: "Jump to table or command in {table}...",
    hostConnection: "Host / Connection",
    switchConnection: "Switch Connection",
    manageConnections: "Manage Connections...",
    disconnect: "Disconnect",
    databases: "Databases",
    filterDatabases: "Filter databases...",
    tableActions: "Table Actions",
    showInDataExplorer: "Show in Data Explorer",
    viewStructure: "View Structure (Schema)",
    openInSqlConsole: "Open in SQL Console",
    copyTableName: "Copy Table Name",
    copiedTableName: "Copied Table Name!",
    switchTable: "Switch Table",
    filterTables: "Filter tables...",
    noDbFound: "No database found",
    noTableFound: "No table found",

    // Settings Modal
    settingsTitle: "Settings & Preferences",
    tabGeneral: "General",
    tabDisplay: "Display & Window",
    tabShortcuts: "Shortcuts",
    
    // Settings: General
    languageSectionTitle: "Interface Language",
    languageSectionDesc: "Choose your preferred language for the dodb workspace.",
    langEnglish: "English",
    langThai: "ภาษาไทย",
    langEnglishSub: "Default interface language",
    langThaiSub: "ส่วนติดต่อผู้ใช้ภาษาไทย",
    
    themeSectionTitle: "Appearance & Theme",
    themeSectionDesc: "Customize the visual appearance of the application.",
    themeDark: "Dark Mode",
    themeDarkSub: "Modern deep charcoal theme for low-light environments",
    themeLight: "Light Mode",
    themeLightSub: "Clean high-contrast theme for bright environments",
    
    // Settings: Display
    uiScaleTitle: "UI Scaling",
    uiScaleDesc: "Adjust the zoom level and element sizing of the application interface.",
    uiScaleCompact: "Compact (85%)",
    uiScaleStandard: "Standard (100%)",
    uiScaleComfortable: "Comfortable (115%)",
    uiScaleLarge: "Large (125%)",
    uiScaleReset: "Reset to Default (100%)",
    currentScale: "Current Scale",
    
    windowDimTitle: "GUI Window Dimensions",
    windowDimDesc: "Set preset or custom resolution for the application window.",
    presetDimensions: "Preset Dimensions",
    customResolution: "Custom Resolution (px)",
    widthPx: "Width (px)",
    heightPx: "Height (px)",
    applySize: "Apply Size",
    windowSizeUpdated: "Window size updated successfully!",
    windowSizeFailed: "Failed to update window size",
    minDimNotice: "Minimum dimensions are 800 x 550 px",
    
    // Settings: Shortcuts
    shortcutsTitle: "Keyboard Shortcuts",
    shortcutsDesc: "Quick reference of handy keyboard shortcuts available across dodb.",
    shortcutCommandPalette: "Command Palette & Quick Search",
    shortcutRunQuery: "Execute Selected / Current SQL Query",
    shortcutFormatSql: "Format SQL Code",
    shortcutRefresh: "Refresh Current Data / Database List",
    shortcutCloseModal: "Close Active Modal / Dropdown",
    shortcutNewQuery: "New SQL Console Tab",
    shortcutToggleSidebar: "Toggle Left Sidebar",

    // Common Buttons & Actions
    close: "Close",
    save: "Save",
    cancel: "Cancel",
    apply: "Apply",
    reset: "Reset",
    refresh: "Refresh",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    search: "Search",
    loading: "Loading...",
    success: "Success",
    error: "Error",
  },
  th: {
    // Header & Navigation
    navExplorer: "ตารางข้อมูล",
    navSql: "คอนโซล SQL",
    navVisualQuery: "เครื่องมือสร้างคิวรี",
    navErd: "ไดอะแกรม ERD",
    navAdmin: "จัดการฐานข้อมูล",
    navImport: "นำเข้าข้อมูล",
    navLogs: "บันทึกการทำงาน",
    navConnections: "การเชื่อมต่อ",
    navSettings: "การตั้งค่า",
    switchThemeDark: "สลับเป็นโหมดมืด (Dark)",
    switchThemeLight: "สลับเป็นโหมดสว่าง (Light)",
    quickSearchPlaceholder: "ค้นหาตาราง, คำสั่ง, เมนูลัดอย่างรวดเร็ว...",
    quickSearchInTable: "ค้นหาข้อมูลหรือคำสั่งใน {table}...",
    hostConnection: "โฮสต์ / การเชื่อมต่อ",
    switchConnection: "สลับการเชื่อมต่อ",
    manageConnections: "จัดการการเชื่อมต่อ...",
    disconnect: "ตัดการเชื่อมต่อ",
    databases: "ฐานข้อมูล",
    filterDatabases: "ค้นหาฐานข้อมูล...",
    tableActions: "คำสั่งตาราง",
    showInDataExplorer: "เปิดในแท็บดูข้อมูล (Explorer)",
    viewStructure: "ดูโครงสร้างตาราง (Schema)",
    openInSqlConsole: "เปิดในคอนโซล SQL",
    copyTableName: "คัดลอกชื่อตาราง",
    copiedTableName: "คัดลอกชื่อตารางแล้ว!",
    switchTable: "สลับตาราง",
    filterTables: "ค้นหาตาราง...",
    noDbFound: "ไม่พบฐานข้อมูล",
    noTableFound: "ไม่พบตาราง",

    // Settings Modal
    settingsTitle: "การตั้งค่าและปรับแต่ง",
    tabGeneral: "ทั่วไป",
    tabDisplay: "การแสดงผลและหน้าต่าง",
    tabShortcuts: "คีย์ลัด",
    
    // Settings: General
    languageSectionTitle: "ภาษาของระบบ (Language)",
    languageSectionDesc: "เลือกภาษาที่ต้องการให้แสดงผลในโปรแกรม dodb",
    langEnglish: "English",
    langThai: "ภาษาไทย",
    langEnglishSub: "Default interface language",
    langThaiSub: "ส่วนติดต่อผู้ใช้ภาษาไทย",
    
    themeSectionTitle: "ธีมและรูปลักษณ์",
    themeSectionDesc: "ปรับแต่งธีมการแสดงผลของหน้าจอตามที่คุณต้องการ",
    themeDark: "โหมดมืด (Dark Mode)",
    themeDarkSub: "โทนสีมืดสบายตา เหมาะกับสภาพแวดล้อมแสงน้อย",
    themeLight: "โหมดสว่าง (Light Mode)",
    themeLightSub: "โทนสีสว่างคมชัด สดใสและอ่านง่าย",
    
    // Settings: Display
    uiScaleTitle: "ขนาดการแสดงผล (UI Scaling)",
    uiScaleDesc: "ปรับระดับการซูมและขนาดขององค์ประกอบต่างๆ ภายในโปรแกรม",
    uiScaleCompact: "กะทัดรัด (85%)",
    uiScaleStandard: "มาตรฐาน (100%)",
    uiScaleComfortable: "สบายตา (115%)",
    uiScaleLarge: "ใหญ่ (125%)",
    uiScaleReset: "รีเซ็ตเป็นค่าเริ่มต้น (100%)",
    currentScale: "ขนาดปัจจุบัน",
    
    windowDimTitle: "ขนาดหน้าต่างโปรแกรม (GUI Window Dimensions)",
    windowDimDesc: "เลือกขนาดหน้าต่างสำเร็จรูปหรือระบุความกว้างและความสูงตามต้องการ",
    presetDimensions: "ขนาดหน้าต่างสำเร็จรูป",
    customResolution: "กำหนดขนาดเอง (พิกเซล)",
    widthPx: "ความกว้าง (px)",
    heightPx: "ความสูง (px)",
    applySize: "บันทึกขนาด",
    windowSizeUpdated: "อัปเดตขนาดหน้าต่างสำเร็จแล้ว!",
    windowSizeFailed: "ไม่สามารถอัปเดตขนาดหน้าต่างได้",
    minDimNotice: "ขนาดขั้นต่ำคือ 800 x 550 พิกเซล",
    
    // Settings: Shortcuts
    shortcutsTitle: "แป้นพิมพ์ลัด (Keyboard Shortcuts)",
    shortcutsDesc: "รายการคีย์ลัดที่มีประโยชน์สำหรับการใช้งาน dodb ให้รวดเร็วยิ่งขึ้น",
    shortcutCommandPalette: "เปิดกล่องค้นหาและคำสั่งด่วน (Command Palette)",
    shortcutRunQuery: "รันคำสั่ง SQL ที่เลือกหรือคำสั่งปัจจุบัน",
    shortcutFormatSql: "จัดรูปแบบโค้ด SQL ให้สวยงาม",
    shortcutRefresh: "รีเฟรชข้อมูลปัจจุบัน / รายการฐานข้อมูล",
    shortcutCloseModal: "ปิดหน้าต่างป๊อปอัปหรือเมนูที่เปิดอยู่",
    shortcutNewQuery: "เปิดแท็บ SQL Console ใหม่",
    shortcutToggleSidebar: "ซ่อน/แสดงแถบด้านข้าง (Sidebar)",

    // Common Buttons & Actions
    close: "ปิด",
    save: "บันทึก",
    cancel: "ยกเลิก",
    apply: "นำไปใช้",
    reset: "รีเซ็ต",
    refresh: "รีเฟรช",
    create: "สร้าง",
    delete: "ลบ",
    edit: "แก้ไข",
    search: "ค้นหา",
    loading: "กำลังโหลด...",
    success: "สำเร็จ",
    error: "ข้อผิดพลาด",
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

export function t(key: TranslationKey, lang: Language = "en", params?: Record<string, string>): string {
  const dict = translations[lang] || translations.en;
  let text: string = dict[key] || translations.en[key] || key;
  
  if (params) {
    Object.entries(params).forEach(([paramKey, paramVal]) => {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, "g"), paramVal);
    });
  }
  return text;
}
