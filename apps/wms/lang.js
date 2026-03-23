/**
 * WMS - 多语言支持 (i18n)
 * 支持: 中文(zh), English(en), ภาษาไทย(th), မြန်မာ(my)
 *
 * 使用方式:
 * 1. HTML元素添加 data-i18n="key" 属性
 * 2. placeholder: data-i18n-placeholder="key"
 * 3. JS中调用: t('key') 获取翻译文本
 * 4. 页面加载自动翻译, 切换语言后自动刷新
 */

// ============================================================================
// 翻译字典
// ============================================================================

var I18N = {
    // ---- 通用 ----
    'app.title': { zh: 'WMS 仓库管理系统', en: 'WMS Warehouse Management', th: 'WMS ระบบจัดการคลังสินค้า', my: 'WMS ဂိုဒေါင်စီမံစနစ်' },
    'app.version': { zh: 'WMS @Foodsaid 维护', en: 'WMS @Foodsaid', th: 'WMS @Foodsaid', my: 'WMS @Foodsaid' },

    // ---- 登录页 ----
    'login.subtitle': { zh: '仓库管理系统', en: 'Warehouse Management System', th: 'ระบบจัดการคลังสินค้า', my: 'ဂိုဒေါင်စီမံခန့်ခွဲမှုစနစ်' },
    'login.username': { zh: '用户名', en: 'Username', th: 'ชื่อผู้ใช้', my: 'အသုံးပြုသူအမည်' },
    'login.username_placeholder': { zh: '请输入用户名', en: 'Enter username', th: 'ป้อนชื่อผู้ใช้', my: 'အသုံးပြုသူအမည်ထည့်ပါ' },
    'login.password': { zh: '密码', en: 'Password', th: 'รหัสผ่าน', my: 'စကားဝှက်' },
    'login.password_placeholder': { zh: '请输入密码', en: 'Enter password', th: 'ป้อนรหัสผ่าน', my: 'စကားဝှက်ထည့်ပါ' },
    'login.btn': { zh: '登 录', en: 'Login', th: 'เข้าสู่ระบบ', my: 'ဝင်ရောက်' },
    'login.logging_in': { zh: '登录中...', en: 'Logging in...', th: 'กำลังเข้าสู่ระบบ...', my: 'ဝင်ရောက်နေသည်...' },
    'logout': { zh: '退出', en: 'Logout', th: 'ออก', my: 'ထွက်' },
    'common.back': { zh: '返回', en: 'Back', th: 'กลับ', my: 'နောက်သို့' },
    'common.submit': { zh: '提交', en: 'Submit', th: 'ส่ง', my: 'တင်ပို့' },
    'common.cancel': { zh: '取消', en: 'Cancel', th: 'ยกเลิก', my: 'ပယ်ဖျက်' },
    'common.confirm': { zh: '确认', en: 'Confirm', th: 'ยืนยัน', my: 'အတည်ပြု' },
    'common.create': { zh: '创建', en: 'Create', th: 'สร้าง', my: 'ဖန်တီး' },
    'common.save': { zh: '保存', en: 'Save', th: 'บันทึก', my: 'သိမ်းဆည်း' },
    'common.delete': { zh: '删除', en: 'Delete', th: 'ลบ', my: 'ဖျက်' },
    'common.search': { zh: '查询', en: 'Search', th: 'ค้นหา', my: 'ရှာဖွေ' },
    'common.reset': { zh: '重新查询', en: 'Reset', th: 'รีเซ็ต', my: 'ပြန်ရှာ' },
    'common.print': { zh: '打印单据', en: 'Print', th: 'พิมพ์', my: 'ပုံနှိပ်' },
    'common.print_barcode': { zh: '打印条码', en: 'Print Barcode', th: 'พิมพ์บาร์โค้ด', my: 'ဘားကုဒ်ပုံနှိပ်' },
    'common.loading': { zh: '加载中...', en: 'Loading...', th: 'กำลังโหลด...', my: 'ဖွင့်နေသည်...' },
    'common.no_data': { zh: '暂无记录', en: 'No records', th: 'ไม่มีข้อมูล', my: 'မှတ်တမ်းမရှိပါ' },
    'common.success': { zh: '操作成功', en: 'Success', th: 'สำเร็จ', my: 'အောင်မြင်' },
    'common.failed': { zh: '操作失败', en: 'Failed', th: 'ล้มเหลว', my: 'မအောင်မြင်' },
    'common.processing': { zh: '处理中...', en: 'Processing...', th: 'กำลังดำเนินการ...', my: 'လုပ်ဆောင်နေသည်...' },
    'common.remark': { zh: '备注', en: 'Remarks', th: 'หมายเหตุ', my: 'မှတ်ချက်' },
    'common.optional': { zh: '选填', en: 'Optional', th: 'ไม่บังคับ', my: 'ရွေးချယ်နိုင်' },
    'common.all': { zh: '全部', en: 'All', th: 'ทั้งหมด', my: 'အားလုံး' },

    // ---- 字段标签 ----
    'field.doc_num': { zh: '订单号', en: 'Doc No.', th: 'เลขที่เอกสาร', my: 'စာရွက်အမှတ်' },
    'field.item_code': { zh: '物料编号', en: 'Item Code', th: 'รหัสสินค้า', my: 'ပစ္စည်းကုဒ်' },
    'field.item_name': { zh: '物料名称', en: 'Item Name', th: 'ชื่อสินค้า', my: 'ပစ္စည်းအမည်' },
    'field.warehouse': { zh: '仓库', en: 'Warehouse', th: 'คลังสินค้า', my: 'ဂိုဒေါင်' },
    'field.planned_qty': { zh: '计划数量', en: 'Planned Qty', th: 'จำนวนแผน', my: 'စီစဉ်အရေအတွက်' },
    'field.actual_qty': { zh: '实际数量', en: 'Actual Qty', th: 'จำนวนจริง', my: 'အမှန်အရေအတွက်' },
    'field.remaining': { zh: '剩余数量', en: 'Remaining', th: 'คงเหลือ', my: 'ကျန်ရှိ' },
    'field.uom': { zh: '单位', en: 'UOM', th: 'หน่วย', my: 'ယူနစ်' },
    'field.due_date': { zh: '到期日', en: 'Due Date', th: 'วันครบกำหนด', my: 'သတ်မှတ်ရက်' },
    'field.sap_status': { zh: 'SAP状态', en: 'SAP Status', th: 'สถานะ SAP', my: 'SAP အခြေအနေ' },
    'field.wms_status': { zh: 'WMS状态', en: 'WMS Status', th: 'สถานะ WMS', my: 'WMS အခြေအနေ' },
    'field.operator': { zh: '操作人', en: 'Operator', th: 'ผู้ปฏิบัติงาน', my: 'လုပ်ဆောင်သူ' },
    'field.qty': { zh: '数量', en: 'Quantity', th: 'จำนวน', my: 'အရေအတွက်' },
    'field.time': { zh: '时间', en: 'Time', th: 'เวลา', my: 'အချိန်' },
    'field.bin': { zh: '库位', en: 'Bin', th: 'ตำแหน่ง', my: 'တည်နေရာ' },
    'field.bin_location': { zh: '库位', en: 'Bin', th: 'ตำแหน่ง', my: 'တည်နေရာ' },
    'field.batch': { zh: '批次号', en: 'Batch No.', th: 'เลขที่ล็อต', my: 'အသုတ်အမှတ်' },
    'field.barcode': { zh: '条码', en: 'Barcode', th: 'บาร์โค้ด', my: 'ဘားကုဒ်' },
    'field.line_num': { zh: '行号', en: 'Line', th: 'แถว', my: 'အတန်း' },
    'field.status': { zh: '状态', en: 'Status', th: 'สถานะ', my: 'အခြေအနေ' },
    'field.date': { zh: '日期', en: 'Date', th: 'วันที่', my: 'ရက်စွဲ' },

    // ---- 状态 ----
    'status.pending': { zh: '待处理', en: 'Pending', th: 'รอดำเนินการ', my: 'စောင့်ဆိုင်း' },
    'status.in_progress': { zh: '执行中', en: 'In Progress', th: 'กำลังดำเนินการ', my: 'ဆောင်ရွက်နေ' },
    'status.completed': { zh: '已完成', en: 'Completed', th: 'เสร็จสิ้น', my: 'ပြီးစီး' },
    'status.cancelled': { zh: '已取消', en: 'Cancelled', th: 'ยกเลิก', my: 'ပယ်ဖျက်ပြီး' },
    'status.exported': { zh: '已导出', en: 'Exported', th: 'ส่งออกแล้ว', my: 'ပို့ပြီး' },

    // ---- 门户页 ----
    'portal.title': { zh: 'WMS 仓库管理', en: 'WMS Warehouse', th: 'WMS คลังสินค้า', my: 'WMS ဂိုဒေါင်' },
    'portal.subtitle': { zh: '扫码快速操作 | 单据管理 | SAP集成', en: 'Quick Scan | Document Mgmt | SAP Integration', th: 'สแกนเร็ว | จัดการเอกสาร | เชื่อมต่อ SAP', my: 'မြန်ဆန်စကင် | စာရွက်စီမံ | SAP ချိတ်ဆက်' },
    'portal.scan_hint': { zh: '扫描条码或输入单号...', en: 'Scan barcode or enter doc no...', th: 'สแกนบาร์โค้ดหรือป้อนเลขที่...', my: 'ဘားကုဒ်စကင် သို့ စာရွက်အမှတ်...' },
    'portal.scan_hint_detail': { zh: 'PO/WO/PI/SO/TR26000000，LM和IC自己产生单据，不和SAP联动', en: 'PO/WO/PI/SO/TR26000000; LM/IC generate own docs', th: 'PO/WO/PI/SO/TR26000000; LM/IC สร้างเองไม่เชื่อม SAP', my: 'PO/WO/PI/SO/TR26000000; LM/IC ကိုယ်ပိုင်စာရွက်' },
    'portal.inbound': { zh: '入库', en: 'Inbound', th: 'รับเข้า', my: 'အဝင်' },
    'portal.outbound': { zh: '出库', en: 'Outbound', th: 'จ่ายออก', my: 'အထွက်' },
    'portal.inventory': { zh: '库存', en: 'Inventory', th: 'สินค้าคงคลัง', my: 'ကုန်ပစ္စည်း' },
    'portal.tools': { zh: '工具', en: 'Tools', th: 'เครื่องมือ', my: 'ကိရိယာ' },

    // ---- 单据类型 ----
    'doctype.PO': { zh: '采购收货', en: 'Purchase Receipt', th: 'รับซื้อ', my: 'ဝယ်ယူလက်ခံ' },
    'doctype.PO.sub': { zh: '采购收货PO', en: 'Purchase Receipt PO', th: 'รับซื้อ PO', my: 'ဝယ်ယူ PO' },
    'doctype.WO': { zh: '生产收货', en: 'Production Receipt', th: 'รับผลิต', my: 'ထုတ်လုပ်လက်ခံ' },
    'doctype.WO.sub': { zh: '生产收货WO', en: 'Production Receipt WO', th: 'รับผลิต WO', my: 'ထုတ်လုပ် WO' },
    'doctype.PI': { zh: '生产发料', en: 'Production Issue', th: 'จ่ายผลิต', my: 'ထုတ်လုပ်ထုတ်ပေး' },
    'doctype.PI.sub': { zh: '发料单', en: 'Issue Doc', th: 'ใบจ่าย', my: 'ထုတ်ပေးစာ' },
    'doctype.SO': { zh: '销售拣货', en: 'Sales Pick', th: 'หยิบขาย', my: 'အရောင်းကောက်' },
    'doctype.SO.sub': { zh: '销售拣货SO', en: 'Sales Pick SO', th: 'หยิบขาย SO', my: 'အရောင်း SO' },
    'doctype.TR': { zh: '调拨申请', en: 'Transfer Request', th: 'ขอโอน', my: 'လွှဲပြောင်းတောင်း' },
    'doctype.TR.sub': { zh: '库间调拨', en: 'Inter-WH Transfer', th: 'โอนระหว่างคลัง', my: 'ဂိုဒေါင်ကြားလွှဲ' },
    'doctype.LM': { zh: '库位移动', en: 'Bin Move', th: 'ย้ายตำแหน่ง', my: 'တည်နေရာရွှေ့' },
    'doctype.LM.sub': { zh: '库位调整', en: 'Bin Transfer', th: 'ปรับตำแหน่ง', my: 'တည်နေရာပြောင်း' },
    'doctype.IC': { zh: '库存盘点', en: 'Stock Count', th: 'ตรวจนับ', my: 'စာရင်းစစ်' },
    'doctype.IC.sub': { zh: '盘点单', en: 'Count Doc', th: 'ใบตรวจนับ', my: 'စစ်ဆေးစာ' },

    // ---- 工具 ----
    'tool.export': { zh: '数据导出', en: 'Data Export', th: 'ส่งออกข้อมูล', my: 'ဒေတာထုတ်' },
    'tool.export.sub': { zh: 'CSV导出', en: 'CSV Export', th: 'ส่งออก CSV', my: 'CSV ထုတ်' },
    'tool.stock': { zh: '库存查询', en: 'Stock Query', th: 'สอบถามสต็อก', my: 'ကုန်ပစ္စည်းရှာ' },
    'tool.stock.sub': { zh: '实时库存', en: 'Real-time Stock', th: 'สต็อกเรียลไทม์', my: 'လက်ရှိကုန်ပစ္စည်း' },
    'tool.report': { zh: '数据报表', en: 'Reports', th: 'รายงาน', my: 'အစီရင်ခံ' },
    'tool.report.sub': { zh: 'BI 报表', en: 'BI Reports', th: 'รายงาน BI', my: 'BI အစီရင်ခံ' },
    'tool.sync': { zh: '数据同步', en: 'Data Sync', th: 'ซิงค์ข้อมูล', my: 'ဒေတာချိန်ညှိ' },
    'tool.sync.sub': { zh: '主数据', en: 'Master Data', th: 'ข้อมูลหลัก', my: 'မာစတာဒေတာ' },

    // ---- PO 采购收货 ----
    'po.title': { zh: '采购订单收货 (PO)', en: 'Purchase Order Receipt (PO)', th: 'รับสินค้าใบสั่งซื้อ (PO)', my: 'ဝယ်ယူလက်ခံ (PO)' },
    'po.subtitle': { zh: '扫描或输入采购订单号，执行收货操作', en: 'Scan or enter PO number to receive goods', th: 'สแกนหรือป้อนเลขที่ PO เพื่อรับสินค้า', my: 'PO နံပါတ်စကင် သို့ ထည့်၍ လက်ခံ' },
    'po.query': { zh: '查询订单', en: 'Query Order', th: 'ค้นหาคำสั่ง', my: 'မှာစာရှာ' },
    'po.scan_hint': { zh: '扫描条码或输入单号...', en: 'Scan barcode or enter doc no...', th: 'สแกนบาร์โค้ดหรือป้อนเลขที่...', my: 'ဘားကုဒ်စကင် သို့ စာရွက်အမှတ်...' },
    'po.order_info': { zh: '订单信息', en: 'Order Info', th: 'ข้อมูลคำสั่ง', my: 'မှာစာအချက်အလက်' },
    'po.line_items': { zh: '行项目', en: 'Line Items', th: 'รายการ', my: 'အတန်းများ' },
    'po.receipt_form': { zh: '收货录入', en: 'Receipt Entry', th: 'บันทึกรับ', my: 'လက်ခံထည့်သွင်း' },
    'po.receipt_qty': { zh: '收货数量', en: 'Receipt Qty', th: 'จำนวนรับ', my: 'လက်ခံအရေအတွက်' },
    'po.receipt_qty_placeholder': { zh: '输入收货数量', en: 'Enter receipt qty', th: 'ป้อนจำนวนรับ', my: 'လက်ခံအရေအတွက်ထည့်' },
    'po.submit_receipt': { zh: '提交收货', en: 'Submit Receipt', th: 'ยืนยันรับ', my: 'လက်ခံတင်ပို့' },
    'po.completed': { zh: '该订单已全部完成收货。', en: 'All items received for this order.', th: 'รับสินค้าครบแล้ว', my: 'ဤမှာစာအားလုံးလက်ခံပြီး' },
    'po.one_click': { zh: '⚡ 一键收货 (剩余全部)', en: '⚡ Receive All Remaining', th: '⚡ รับทั้งหมดที่เหลือ', my: '⚡ ကျန်အားလုံးလက်ခံ' },
    'po.batch_submit': { zh: '⚡ 批量收货 (全部)', en: '⚡ Batch Receive All', th: '⚡ รับทั้งหมด', my: '⚡ အားလုံးလက်ခံ' },
    'po.history': { zh: '操作历史', en: 'History', th: 'ประวัติ', my: 'မှတ်တမ်း' },
    'po.wms_received': { zh: 'WMS已收', en: 'WMS Received', th: 'WMS รับแล้ว', my: 'WMS လက်ခံပြီး' },

    // ---- WO 生产订单 ----
    'wo.title': { zh: '生产订单收货 (WO)', en: 'Work Order Receipt (WO)', th: 'รับผลิตภัณฑ์ (WO)', my: 'ထုတ်လုပ်လက်ခံ (WO)' },
    'wo.subtitle': { zh: '扫描或输入生产订单号，执行收货操作', en: 'Scan or enter WO number to receive', th: 'สแกนหรือป้อน WO เพื่อรับสินค้า', my: 'WO နံပါတ်စကင် သို့ ထည့်၍ လက်ခံ' },
    'wo.receipt_form': { zh: '收货录入', en: 'Receipt Entry', th: 'บันทึกรับ', my: 'လက်ခံထည့်သွင်း' },
    'wo.one_click': { zh: '⚡ 一键收货 (剩余全部)', en: '⚡ Receive All Remaining', th: '⚡ รับทั้งหมดที่เหลือ', my: '⚡ ကျန်အားလုံးလက်ခံ' },

    // ---- PI 生产发料 ----
    'pi.title': { zh: '生产发料 (PI)', en: 'Production Issue (PI)', th: 'จ่ายวัตถุดิบ (PI)', my: 'ထုတ်လုပ်ထုတ်ပေး (PI)' },
    'pi.subtitle': { zh: '扫描或输入生产订单号，执行发料操作', en: 'Scan or enter order no. to issue materials', th: 'สแกนหรือป้อนเลขที่เพื่อจ่ายวัตถุดิบ', my: 'မှာစာနံပါတ်ထည့်၍ ပစ္စည်းထုတ်ပေး' },
    'pi.issue_form': { zh: '发料录入', en: 'Issue Entry', th: 'บันทึกจ่าย', my: 'ထုတ်ပေးထည့်သွင်း' },
    'pi.issue_qty': { zh: '发料数量', en: 'Issue Qty', th: 'จำนวนจ่าย', my: 'ထုတ်ပေးအရေအတွက်' },
    'pi.submit_issue': { zh: '提交发料', en: 'Submit Issue', th: 'ยืนยันจ่าย', my: 'ထုတ်ပေးတင်ပို့' },

    // ---- SO 销售拣货 ----
    'so.title': { zh: '销售订单拣货 (SO)', en: 'Sales Order Pick (SO)', th: 'หยิบสินค้าขาย (SO)', my: 'အရောင်းကောက်ယူ (SO)' },
    'so.subtitle': { zh: '扫描或输入销售订单号，执行拣货操作', en: 'Scan or enter SO number to pick', th: 'สแกนหรือป้อน SO เพื่อหยิบสินค้า', my: 'SO နံပါတ်ထည့်၍ ကောက်ယူ' },
    'so.pick_form': { zh: '拣货录入', en: 'Pick Entry', th: 'บันทึกหยิบ', my: 'ကောက်ယူထည့်သွင်း' },
    'so.pick_qty': { zh: '拣货数量', en: 'Pick Qty', th: 'จำนวนหยิบ', my: 'ကောက်ယူအရေအတွက်' },
    'so.submit_pick': { zh: '提交拣货', en: 'Submit Pick', th: 'ยืนยันหยิบ', my: 'ကောက်ယူတင်ပို့' },

    // ---- TR 调拨 ----
    'tr.title': { zh: '调拨申请 (TR)', en: 'Transfer Request (TR)', th: 'คำขอโอน (TR)', my: 'လွှဲပြောင်းတောင်းဆို (TR)' },
    'tr.subtitle': { zh: '扫描或输入调拨申请号，执行库间调拨', en: 'Scan or enter TR number to transfer', th: 'สแกนหรือป้อน TR เพื่อโอน', my: 'TR နံပါတ်ထည့်၍ လွှဲပြောင်း' },
    'tr.transfer_form': { zh: '调拨录入', en: 'Transfer Entry', th: 'บันทึกโอน', my: 'လွှဲပြောင်းထည့်သွင်း' },
    'tr.transfer_qty': { zh: '调拨数量', en: 'Transfer Qty', th: 'จำนวนโอน', my: 'လွှဲပြောင်းအရေအတွက်' },
    'tr.submit_transfer': { zh: '提交调拨', en: 'Submit Transfer', th: 'ยืนยันโอน', my: 'လွှဲပြောင်းတင်ပို့' },

    // ---- LM 库位移动 ----
    'lm.title': { zh: '库位移动 (LM)', en: 'Bin Move (LM)', th: 'ย้ายตำแหน่ง (LM)', my: 'တည်နေရာရွှေ့ (LM)' },
    'lm.subtitle': { zh: '在同一仓库内移动物料到不同库位', en: 'Move items to different bins within warehouse', th: 'ย้ายสินค้าไปตำแหน่งอื่นในคลัง', my: 'ဂိုဒေါင်အတွင်းတည်နေရာပြောင်း' },
    'lm.select_op': { zh: '选择操作', en: 'Select Action', th: 'เลือกการดำเนินการ', my: 'လုပ်ဆောင်ချက်ရွေး' },
    'lm.new_move': { zh: '新建移库单', en: 'New Move Doc', th: 'สร้างใบย้าย', my: 'ရွှေ့စာအသစ်' },
    'lm.load_move': { zh: '查看移库凭证', en: 'View Move Doc', th: 'ดูใบย้าย', my: 'ရွှေ့စာကြည့်' },
    'lm.move_info': { zh: '移库信息', en: 'Move Info', th: 'ข้อมูลการย้าย', my: 'ရွှေ့အချက်အလက်' },
    'lm.move_entry': { zh: '移库录入', en: 'Move Entry', th: 'บันทึกย้าย', my: 'ရွှေ့ထည့်သွင်း' },
    'lm.scan_item': { zh: '扫描物料条码 *', en: 'Scan Item Barcode *', th: 'สแกนบาร์โค้ดสินค้า *', my: 'ပစ္စည်းဘားကုဒ်စကင် *' },
    'lm.from_bin': { zh: '源库位 *', en: 'From Bin *', th: 'ตำแหน่งต้นทาง *', my: 'မူရင်းတည်နေရာ *' },
    'lm.to_bin': { zh: '目标库位 *', en: 'To Bin *', th: 'ตำแหน่งปลายทาง *', my: 'ဦးတည်တည်နေရာ *' },
    'lm.move_qty': { zh: '移动数量 *', en: 'Move Qty *', th: 'จำนวนย้าย *', my: 'ရွှေ့အရေအတွက် *' },
    'lm.confirm_move': { zh: '确认移库', en: 'Confirm Move', th: 'ยืนยันย้าย', my: 'ရွှေ့အတည်ပြု' },
    'lm.add_line': { zh: '添加明细', en: 'Add Line', th: 'เพิ่มรายการ', my: 'အတန်းထည့်' },
    'lm.pending_list': { zh: '待提交清单', en: 'Pending List', th: 'รายการรอส่ง', my: 'စောင့်ဆိုင်းစာရင်း' },
    'lm.batch_submit': { zh: '批量提交', en: 'Batch Submit', th: 'ส่งทั้งหมด', my: 'အားလုံးတင်ပို့' },
    'lm.clear_list': { zh: '清空', en: 'Clear', th: 'ล้าง', my: 'ရှင်းလင်း' },
    'lm.complete': { zh: '完成移库', en: 'Complete Move', th: 'เสร็จสิ้นการย้าย', my: 'ရွှေ့ပြီးစီး' },
    'lm.detail': { zh: '移库明细', en: 'Move Details', th: 'รายละเอียดการย้าย', my: 'ရွှေ့အသေးစိတ်' },
    'lm.moved_count': { zh: '已移动', en: 'Moved', th: 'ย้ายแล้ว', my: 'ရွှေ့ပြီး' },
    'lm.debit': { zh: '借(入)', en: 'Debit(In)', th: 'เดบิต(เข้า)', my: 'ဒက်ဘစ်(အဝင်)' },
    'lm.credit': { zh: '贷(出)', en: 'Credit(Out)', th: 'เครดิต(ออก)', my: 'ခရက်ဒစ်(အထွက်)' },
    'lm.whs_code': { zh: '仓库代码 *', en: 'Warehouse Code *', th: 'รหัสคลัง *', my: 'ဂိုဒေါင်ကုဒ် *' },

    // ---- IC 盘点 ----
    'ic.title': { zh: '库存盘点 (IC)', en: 'Stock Count (IC)', th: 'ตรวจนับสต็อก (IC)', my: 'စာရင်းစစ် (IC)' },
    'ic.subtitle': { zh: '创建盘点单，扫描物料录入实盘差异', en: 'Create count doc, scan items to record variance', th: 'สร้างใบนับ สแกนสินค้าเพื่อบันทึกผลต่าง', my: 'စစ်ဆေးစာဖန်တီး၍ ကွာခြားချက်မှတ်' },
    'ic.new_count': { zh: '新建盘点单', en: 'New Count Doc', th: 'สร้างใบนับ', my: 'စစ်ဆေးစာအသစ်' },
    'ic.load_count': { zh: '查看盘点凭证', en: 'View Count Doc', th: 'ดูใบนับ', my: 'စစ်ဆေးစာကြည့်' },
    'ic.count_info': { zh: '盘点信息', en: 'Count Info', th: 'ข้อมูลการนับ', my: 'စစ်ဆေးအချက်အလက်' },
    'ic.scan_count': { zh: '扫码盘点', en: 'Scan & Count', th: 'สแกนและนับ', my: 'စကင်ပြီးစစ်' },
    'ic.count_qty': { zh: '实盘和系统的差异 *', en: 'Variance (Actual - System) *', th: 'ผลต่าง (จริง - ระบบ) *', my: 'ကွာခြားချက် (အမှန် - စနစ်) *' },
    'ic.count_qty_hint': { zh: '正数=实际比系统多，负数=实际比系统少', en: 'Positive = actual > system, Negative = actual < system', th: 'บวก=จริงมากกว่าระบบ ลบ=จริงน้อยกว่าระบบ', my: 'အပေါင်း=အမှန်>စနစ်, အနုတ်=အမှန်<စနစ်' },
    'ic.record': { zh: '记录盘点', en: 'Record Count', th: 'บันทึกการนับ', my: 'စစ်ဆေးမှတ်' },
    'ic.complete': { zh: '完成盘点', en: 'Complete Count', th: 'เสร็จสิ้นการนับ', my: 'စစ်ဆေးပြီးစီး' },
    'ic.detail': { zh: '盘点明细', en: 'Count Details', th: 'รายละเอียดการนับ', my: 'စစ်ဆေးအသေးစိတ်' },
    'ic.counted': { zh: '已盘品种', en: 'Counted Items', th: 'สินค้าที่นับแล้ว', my: 'စစ်ပြီးပစ္စည်း' },
    'ic.counter': { zh: '盘点人 *', en: 'Counter *', th: 'ผู้นับ *', my: 'စစ်ဆေးသူ *' },

    // ---- 库存查询 ----
    'stock.title': { zh: '库存查询', en: 'Stock Query', th: 'สอบถามสต็อก', my: 'ကုန်ပစ္စည်းရှာ' },
    'stock.subtitle': { zh: '查询物料实时库存 (SAP快照+当天WMS变动)', en: 'Query real-time stock (SAP snapshot + today WMS)', th: 'สอบถามสต็อกเรียลไทม์', my: 'လက်ရှိကုန်ပစ္စည်းရှာ (SAP+WMS)' },
    'stock.scan_hint': { zh: '输入物料编码、批次号，或扫描物料条码', en: 'Enter item code, batch, or scan barcode', th: 'ป้อนรหัสสินค้า ล็อต หรือสแกน', my: 'ပစ္စည်းကုဒ် အသုတ် သို့ ဘားကုဒ်စကင်' },

    // ---- 数据导出 ----
    'export.title': { zh: 'WMS数据导出', en: 'WMS Data Export', th: 'ส่งออกข้อมูล WMS', my: 'WMS ဒေတာထုတ်' },
    'export.subtitle': { zh: '导出WMS单据数据，支持按类型/状态/日期筛选', en: 'Export WMS data by type/status/date', th: 'ส่งออกข้อมูลตามประเภท/สถานะ/วันที่', my: 'အမျိုးအစား/အခြေအနေ/ရက်စွဲဖြင့် ဒေတာထုတ်' },
    'export.filter': { zh: '筛选条件', en: 'Filters', th: 'ตัวกรอง', my: 'စစ်ထုတ်' },
    'export.doc_type': { zh: '单据类型', en: 'Doc Type', th: 'ประเภทเอกสาร', my: 'စာရွက်အမျိုးအစား' },
    'export.date_from': { zh: '开始日期', en: 'From Date', th: 'จากวันที่', my: 'မှရက်စွဲ' },
    'export.date_to': { zh: '结束日期', en: 'To Date', th: 'ถึงวันที่', my: 'ထိရက်စွဲ' },
    'export.query': { zh: '查询', en: 'Query', th: 'ค้นหา', my: 'ရှာဖွေ' },
    'export.csv': { zh: '导出CSV', en: 'Export CSV', th: 'ส่งออก CSV', my: 'CSV ထုတ်' },
    'export.mark': { zh: '标记已导出', en: 'Mark Exported', th: 'ทำเครื่องหมายส่งออกแล้ว', my: 'ပို့ပြီးအမှတ်ခြစ်' },
    'export.doc_list': { zh: '单据列表', en: 'Document List', th: 'รายการเอกสาร', my: 'စာရွက်စာရင်း' },
    'export.stats': { zh: '导出统计', en: 'Export Stats', th: 'สถิติการส่งออก', my: 'ထုတ်ပြီးစာရင်း' },
    'export.pending': { zh: '待导出', en: 'Pending Export', th: 'รอส่งออก', my: 'ထုတ်ရန်စောင့်' },

    // ---- 数据同步 ----
    'sync.title': { zh: '数据同步', en: 'Data Sync', th: 'ซิงค์ข้อมูล', my: 'ဒေတာချိန်ညှိ' },
    'sync.items': { zh: '同步物料', en: 'Sync Items', th: 'ซิงค์สินค้า', my: 'ပစ္စည်းချိန်ညှိ' },
    'sync.warehouses': { zh: '同步仓库', en: 'Sync Warehouses', th: 'ซิงค์คลัง', my: 'ဂိုဒေါင်ချိန်ညှိ' },
    'sync.bins': { zh: '同步库位', en: 'Sync Bins', th: 'ซิงค์ตำแหน่ง', my: 'တည်နေရာချိန်ညှိ' },
    'sync.stock': { zh: '同步库存快照', en: 'Sync Stock Snapshot', th: 'ซิงค์สแน็ปช็อตสต็อก', my: 'ကုန်ပစ္စည်းချိန်ညှိ' },
    'sync.items_btn': { zh: '\u{1F4E6} 物料', en: '\u{1F4E6} Items', th: '\u{1F4E6} สินค้า', my: '\u{1F4E6} ပစ္စည်း' },
    'sync.whs_btn': { zh: '\u{1F3E2} 仓库', en: '\u{1F3E2} Warehouses', th: '\u{1F3E2} คลัง', my: '\u{1F3E2} ဂိုဒေါင်' },
    'sync.bins_btn': { zh: '\u{1F5C3} 库位', en: '\u{1F5C3} Bins', th: '\u{1F5C3} ตำแหน่ง', my: '\u{1F5C3} တည်နေရာ' },
    'sync.stock_btn': { zh: '\u{1F4C8} 库存快照', en: '\u{1F4C8} Snapshot', th: '\u{1F4C8} สแน็ปช็อต', my: '\u{1F4C8} ကုန်ပစ္စည်း' },
    'sync.checking': { zh: '正在检查 SAP 数据更新状态...', en: 'Checking SAP data update status...', th: 'กำลังตรวจสอบสถานะข้อมูล SAP...', my: 'SAP ဒေတာအခြေအနေ စစ်ဆေးနေ...' },

    // ---- 门户页补充 ----
    'portal.scan_entry': { zh: '扫码快速入口', en: 'Quick Scan Entry', th: 'สแกนเข้าเร็ว', my: 'မြန်ဆန်စကင်' },
    'portal.doc_ops': { zh: '单据操作', en: 'Document Operations', th: 'การดำเนินการเอกสาร', my: 'စာရွက်လုပ်ဆောင်ချက်' },
    'portal.today': { zh: '今日概览', en: 'Today Overview', th: 'ภาพรวมวันนี้', my: 'ယနေ့အကျဉ်းချုပ်' },

    // ---- 字段补充 ----
    'field.supplier': { zh: '供应商', en: 'Supplier', th: 'ซัพพลายเออร์', my: 'ပေးသွင်းသူ' },
    'field.customer': { zh: '客户', en: 'Customer', th: 'ลูกค้า', my: 'ဝယ်သူ' },
    'field.delivery_date': { zh: '交货日', en: 'Delivery Date', th: 'วันส่งมอบ', my: 'ပို့ဆောင်ရက်' },
    'field.prod_date': { zh: '生产日期', en: 'Production Date', th: 'วันที่ผลิต', my: 'ထုတ်လုပ်ရက်' },
    'field.product_code': { zh: '成品编号', en: 'Product Code', th: 'รหัสผลิตภัณฑ์', my: 'ထုတ်ကုန်ကုဒ်' },
    'field.product_name': { zh: '成品名称', en: 'Product Name', th: 'ชื่อผลิตภัณฑ์', my: 'ထုတ်ကုန်အမည်' },
    'field.from_whs': { zh: '源仓库', en: 'From Warehouse', th: 'คลังต้นทาง', my: 'မူရင်းဂိုဒေါင်' },
    'field.to_whs': { zh: '目标仓库', en: 'To Warehouse', th: 'คลังปลายทาง', my: 'ဦးတည်ဂိုဒေါင်' },
    'field.bin_optional': { zh: '库位 (选填)', en: 'Bin (Optional)', th: 'ตำแหน่ง (ไม่บังคับ)', my: 'တည်နေရာ (ရွေးချယ်)' },
    'field.sap_doc_num': { zh: 'SAP单号', en: 'SAP Doc No.', th: 'เลขที่ SAP', my: 'SAP စာရွက်အမှတ်' },
    'field.line_count': { zh: '行数', en: 'Lines', th: 'จำนวนแถว', my: 'အတန်းအရေအတွက်' },
    'field.total_qty': { zh: '总数量', en: 'Total Qty', th: 'จำนวนรวม', my: 'စုစုပေါင်း' },
    'field.quantity': { zh: '数量', en: 'Quantity', th: 'จำนวน', my: 'အရေအတွက်' },

    // ---- PI 补充 ----
    'pi.bom_list': { zh: 'BOM物料清单 (发料)', en: 'BOM Material List (Issue)', th: 'รายการ BOM (จ่าย)', my: 'BOM ပစ္စည်းစာရင်း (ထုတ်ပေး)' },
    'pi.issued': { zh: '已发', en: 'Issued', th: 'จ่ายแล้ว', my: 'ထုတ်ပေးပြီး' },
    'pi.pending_issue': { zh: '待发', en: 'Pending', th: 'รอจ่าย', my: 'ထုတ်ရန်စောင့်' },
    'pi.history': { zh: '发料历史', en: 'Issue History', th: 'ประวัติจ่าย', my: 'ထုတ်ပေးမှတ်တမ်း' },

    // ---- SO 补充 ----
    'so.line_items': { zh: '行项目 (拣货)', en: 'Line Items (Pick)', th: 'รายการ (หยิบ)', my: 'အတန်းများ (ကောက်ယူ)' },
    'so.delivered': { zh: '已发', en: 'Delivered', th: 'จัดส่งแล้ว', my: 'ပို့ပြီး' },
    'so.pending_pick': { zh: '待拣', en: 'Pending', th: 'รอหยิบ', my: 'ကောက်ရန်စောင့်' },
    'so.history': { zh: '拣货历史', en: 'Pick History', th: 'ประวัติหยิบ', my: 'ကောက်ယူမှတ်တမ်း' },

    // ---- TR 补充 ----
    'tr.info': { zh: '调拨信息', en: 'Transfer Info', th: 'ข้อมูลการโอน', my: 'လွှဲပြောင်းအချက်အလက်' },
    'tr.line_items': { zh: '行项目 (调拨)', en: 'Line Items (Transfer)', th: 'รายการ (โอน)', my: 'အတန်းများ (လွှဲပြောင်း)' },
    'tr.transferred': { zh: '已转', en: 'Transferred', th: 'โอนแล้ว', my: 'လွှဲပြီး' },
    'tr.pending_transfer': { zh: '待转', en: 'Pending', th: 'รอโอน', my: 'လွှဲရန်စောင့်' },
    'tr.history': { zh: '调拨历史', en: 'Transfer History', th: 'ประวัติการโอน', my: 'လွှဲပြောင်းမှတ်တမ်း' },

    // ---- LM 补充 ----
    'lm.debit_credit': { zh: '借/贷', en: 'Dr/Cr', th: 'เดบิต/เครดิต', my: 'ဒက်/ခရက်' },

    // ---- 库存查询补充 ----
    'stock.clear': { zh: '清空', en: 'Clear', th: 'ล้าง', my: 'ရှင်းလင်း' },

    // ---- 通用补充 (兼容别名) ----
    'common.print_doc': { zh: '打印单据', en: 'Print Document', th: 'พิมพ์เอกสาร', my: 'စာရွက်ပုံနှိပ်' },
    'common.re_query': { zh: '重新查询', en: 'Re-query', th: 'ค้นหาใหม่', my: 'ပြန်ရှာ' },

    // ---- V17.0: 库存查询页完整i18n ----
    'stock.whs_placeholder': { zh: '选择或输入仓库代码（留空=全部）', en: 'Warehouse code (blank=all)', th: 'รหัสคลัง (เว้น=ทั้งหมด)', my: 'ဂိုဒေါင်ကုဒ် (ကွက်လပ်=အားလုံး)' },
    'stock.bin_placeholder': { zh: '库位筛选（留空=全部）', en: 'Bin filter (blank=all)', th: 'กรองตำแหน่ง (เว้น=ทั้งหมด)', my: 'တည်နေရာစစ် (ကွက်လပ်=အားလုံး)' },
    'stock.item_placeholder': { zh: '扫描物料条码...', en: 'Scan item barcode...', th: 'สแกนบาร์โค้ดสินค้า...', my: 'ပစ္စည်းဘားကုဒ်စကင်...' },
    'stock.col_item_code': { zh: '物料号', en: 'Item Code', th: 'รหัสสินค้า', my: 'ပစ္စည်းကုဒ်' },
    'stock.col_item_name': { zh: '物料名称', en: 'Item Name', th: 'ชื่อสินค้า', my: 'ပစ္စည်းအမည်' },
    'stock.col_whs': { zh: '仓库', en: 'Warehouse', th: 'คลัง', my: 'ဂိုဒေါင်' },
    'stock.col_bin': { zh: '库位', en: 'Bin', th: 'ตำแหน่ง', my: 'တည်နေရာ' },
    'stock.col_batch': { zh: '批次', en: 'Batch', th: 'ล็อต', my: 'အသုတ်' },
    'stock.col_snap': { zh: '快照数', en: 'Snapshot', th: 'สแน็ปช็อต', my: 'ပုံရိပ်' },
    'stock.col_delta': { zh: 'WMS变动', en: 'WMS Delta', th: 'WMS ผลต่าง', my: 'WMS ပြောင်းလဲ' },
    'stock.col_realtime': { zh: '实时库存', en: 'Real-time', th: 'เรียลไทม์', my: 'လက်ရှိ' },
    'stock.col_uom': { zh: '单位', en: 'UOM', th: 'หน่วย', my: 'ယူနစ်' },
    'stock.summary': { zh: '共 {0} 种物料, {1} 条明细 | 合计实时库存: {2}', en: '{0} items, {1} rows | Total: {2}', th: '{0} สินค้า, {1} แถว | รวม: {2}', my: 'ပစ္စည်း {0}, အတန်း {1} | စုစုပေါင်း: {2}' },
    'stock.page_info': { zh: '第 {0} / {1} 页', en: 'Page {0}/{1}', th: 'หน้า {0}/{1}', my: 'စာမျက်နှာ {0}/{1}' },
    'stock.detail_rows': { zh: '{0} 条明细', en: '{0} rows', th: '{0} แถว', my: '{0} အတန်း' },
    'stock.empty_title': { zh: '请扫描或输入物料代码开始查询', en: 'Scan or enter item code to query', th: 'สแกนหรือป้อนรหัสสินค้าเพื่อค้นหา', my: 'ပစ္စည်းကုဒ်ထည့်၍ စတင်ရှာ' },
    'stock.empty_hint': { zh: '支持物料编码、批次号查询', en: 'Supports item code and batch number', th: 'รองรับรหัสสินค้าและเลขที่ล็อต', my: 'ပစ္စည်းကုဒ်နှင့် အသုတ်အမှတ်' },
    'stock.no_result': { zh: '查无物料库存', en: 'No stock found', th: 'ไม่พบสต็อก', my: 'ကုန်ပစ္စည်းမတွေ့ပါ' },
    'stock.no_result_hint': { zh: '请确认条件正确，或等待今晚22:00快照同步', en: 'Verify criteria or wait for 22:00 snapshot sync', th: 'ตรวจสอบเงื่อนไขหรือรอซิงค์ 22:00', my: 'အခြေအနေစစ်ပါ သို့ 22:00 ချိန်ညှိစောင့်ပါ' },
    'stock.query_error': { zh: '查询出错', en: 'Query Error', th: 'ข้อผิดพลาดในการค้นหา', my: 'ရှာဖွေရာတွင်အမှား' },
    'stock.input_hint': { zh: '请输入物料代码、仓库或库位', en: 'Enter item code, warehouse or bin', th: 'ป้อนรหัสสินค้า คลัง หรือตำแหน่ง', my: 'ပစ္စည်းကုဒ် ဂိုဒေါင် သို့ တည်နေရာ' },

    // ---- V17.0: 门户页i18n ----
    'portal.loading': { zh: '加载中...', en: 'Loading...', th: 'กำลังโหลด...', my: 'ဖွင့်နေသည်...' },
    'portal.today_ops': { zh: '今日操作', en: "Today's Operations", th: 'ปฏิบัติการวันนี้', my: 'ယနေ့လုပ်ဆောင်ချက်' },
    'portal.in_progress_count': { zh: '进行中', en: 'In Progress', th: 'กำลังดำเนินการ', my: 'ဆောင်ရွက်နေ' },
    'portal.today_completed': { zh: '今日完成', en: 'Completed Today', th: 'เสร็จวันนี้', my: 'ယနေ့ပြီးစီး' },
    'portal.pending_export_label': { zh: '待导出', en: 'Pending Export', th: 'รอส่งออก', my: 'ထုတ်ရန်စောင့်' },
    'portal.docs_unit': { zh: ' 单', en: ' docs', th: ' รายการ', my: ' စာရွက်' },
    'portal.system_status': { zh: '系统状态', en: 'System Status', th: 'สถานะระบบ', my: 'စနစ်အခြေအနေ' },
    'portal.system_ok': { zh: '正常运行', en: 'Running OK', th: 'ทำงานปกติ', my: 'ကောင်းမွန်စွာလည်ပတ်နေ' },
    'portal.hint_label': { zh: '提示', en: 'Tip', th: 'คำแนะนำ', my: 'အကြံပြု' },
    'portal.hint_text': { zh: '扫描条码或点击上方磁贴开始操作', en: 'Scan barcode or tap a tile above', th: 'สแกนบาร์โค้ดหรือแตะไทล์ด้านบน', my: 'ဘားကုဒ်စကင် သို့ အပေါ်ကပုံနှိပ်ပါ' },
    'portal.no_data': { zh: '暂无数据', en: 'No data', th: 'ไม่มีข้อมูล', my: 'ဒေတာမရှိပါ' },
    'portal.syncing': { zh: '同步中...', en: 'Syncing...', th: 'กำลังซิงค์...', my: 'ချိန်ညှိနေသည်...' },
    'portal.sync_items_done': { zh: '物料同步完成', en: 'Items synced', th: 'ซิงค์สินค้าเสร็จ', my: 'ပစ္စည်းချိန်ညှိပြီး' },
    'portal.sync_whs_done': { zh: '仓库同步完成', en: 'Warehouses synced', th: 'ซิงค์คลังเสร็จ', my: 'ဂိုဒေါင်ချိန်ညှိပြီး' },
    'portal.sync_bins_done': { zh: '库位同步完成', en: 'Bins synced', th: 'ซิงค์ตำแหน่งเสร็จ', my: 'တည်နေရာချိန်ညှိပြီး' },
    'portal.sync_stock_done': { zh: '库存快照同步完成', en: 'Stock snapshot synced', th: 'ซิงค์สแน็ปช็อตเสร็จ', my: 'ကုန်ပစ္စည်းချိန်ညှိပြီး' },
    'portal.sync_stock_hint': { zh: '库存快照同步中，可能需要几分钟...', en: 'Syncing stock snapshot, may take minutes...', th: 'กำลังซิงค์สแน็ปช็อต อาจใช้เวลาหลายนาที...', my: 'ကုန်ပစ္စည်းချိန်ညှိနေ မိနစ်အနည်းငယ်ကြာနိုင်...' },

    // ---- V17.0: 导出页i18n ----
    'export.type_all': { zh: '全部', en: 'All Types', th: 'ทุกประเภท', my: 'အားလုံး' },
    'export.type_so': { zh: '销售订单 (SO)', en: 'Sales Order (SO)', th: 'คำสั่งขาย (SO)', my: 'အရောင်းမှာစာ (SO)' },
    'export.type_wo': { zh: '生产订单 (WO)', en: 'Work Order (WO)', th: 'ใบสั่งผลิต (WO)', my: 'ထုတ်လုပ်မှာစာ (WO)' },
    'export.type_po': { zh: '采购订单 (PO)', en: 'Purchase Order (PO)', th: 'ใบสั่งซื้อ (PO)', my: 'ဝယ်ယူမှာစာ (PO)' },
    'export.type_tr': { zh: '调拨申请 (TR)', en: 'Transfer Request (TR)', th: 'คำขอโอน (TR)', my: 'လွှဲပြောင်းတောင်း (TR)' },
    'export.type_ic': { zh: '库存盘点 (IC)', en: 'Stock Count (IC)', th: 'ตรวจนับ (IC)', my: 'စာရင်းစစ် (IC)' },
    'export.type_lm': { zh: '库位移动 (LM)', en: 'Bin Move (LM)', th: 'ย้ายตำแหน่ง (LM)', my: 'တည်နေရာရွှေ့ (LM)' },
    'export.type_pi': { zh: '生产发货 (PI)', en: 'Production Issue (PI)', th: 'จ่ายผลิต (PI)', my: 'ထုတ်လုပ်ထုတ်ပေး (PI)' },
    'export.status_pending': { zh: '待导出', en: 'Pending Export', th: 'รอส่งออก', my: 'ထုတ်ရန်စောင့်' },
    'export.status_progress': { zh: '执行中', en: 'In Progress', th: 'กำลังดำเนินการ', my: 'ဆောင်ရွက်နေ' },
    'export.status_completed': { zh: '已完成', en: 'Completed', th: 'เสร็จสิ้น', my: 'ပြီးစီး' },
    'export.status_exported': { zh: '已导出', en: 'Exported', th: 'ส่งออกแล้ว', my: 'ပို့ပြီး' },
    'export.status_all': { zh: '全部', en: 'All Status', th: 'ทุกสถานะ', my: 'အားလုံး' },
    'export.load_hint': { zh: '请点击"查询"加载数据', en: 'Click "Query" to load data', th: 'คลิก "ค้นหา" เพื่อโหลดข้อมูล', my: '"ရှာဖွေ" နှိပ်၍ ဒေတာဖွင့်ပါ' },
    'export.no_match': { zh: '无匹配数据', en: 'No matching data', th: 'ไม่พบข้อมูลที่ตรงกัน', my: 'ကိုက်ညီသောဒေတာမရှိ' },

    // ---- PDA 占位符翻译 ----
    'field.bin_placeholder': { zh: '默认 SYSTEM-BIN', en: 'Default SYSTEM-BIN', th: 'ค่าเริ่มต้น SYSTEM-BIN', my: 'ပုံသေ SYSTEM-BIN' },
    'field.operator_placeholder': { zh: '操作人姓名', en: 'Operator name', th: 'ชื่อผู้ปฏิบัติงาน', my: 'လုပ်ဆောင်သူအမည်' },
    'field.remark_placeholder': { zh: '选填备注', en: 'Optional remarks', th: 'หมายเหตุ (ไม่บังคับ)', my: 'မှတ်ချက် (ရွေးချယ်)' },

    // ---- IC 页面占位符 ----
    'ic.whs_placeholder': { zh: '输入仓库代码', en: 'Enter warehouse code', th: 'ป้อนรหัสคลัง', my: 'ဂိုဒေါင်ကုဒ်ထည့်' },
    'ic.counter_placeholder': { zh: '输入盘点人姓名', en: 'Enter counter name', th: 'ป้อนชื่อผู้นับ', my: 'စစ်ဆေးသူအမည်ထည့်' },
    'ic.load_placeholder': { zh: '输入盘点单号或扫描条码...', en: 'Enter count doc no. or scan...', th: 'ป้อนเลขที่ใบนับหรือสแกน...', my: 'စစ်ဆေးစာအမှတ် သို့ စကင်...' },
    'ic.scan_item_placeholder': { zh: '扫描物料条码...', en: 'Scan item barcode...', th: 'สแกนบาร์โค้ดสินค้า...', my: 'ပစ္စည်းဘားကုဒ်စကင်...' },
    'ic.qty_placeholder': { zh: '正数=多, 负数=少', en: 'Positive=more, Negative=less', th: 'บวก=มาก, ลบ=น้อย', my: 'အပေါင်း=များ, အနုတ်=နည်း' },
    'field.bin_input_placeholder': { zh: '输入或扫描库位...', en: 'Enter or scan bin...', th: 'ป้อนหรือสแกนตำแหน่ง...', my: 'တည်နေရာထည့် သို့ စကင်...' },
    'field.warehouse_placeholder': { zh: '仓库代码', en: 'Warehouse code', th: 'รหัสคลัง', my: 'ဂိုဒေါင်ကုဒ်' },

    // 数量占位符 (V18.3)
    'po.receipt_qty_hint': { zh: '输入收货数量', en: 'Enter receipt qty', th: 'ป้อนจำนวนรับ', my: 'လက်ခံအရေအတွက်ထည့်' },
    'wo.receipt_qty_hint': { zh: '输入收货数量', en: 'Enter receipt qty', th: 'ป้อนจำนวนรับ', my: 'လက်ခံအရေအတွက်ထည့်' },
    'so.pick_qty_hint': { zh: '输入拣货数量', en: 'Enter pick qty', th: 'ป้อนจำนวนหยิบ', my: 'ကောက်ယူအရေအတွက်ထည့်' },
    'pi.issue_qty_hint': { zh: '输入发料数量', en: 'Enter issue qty', th: 'ป้อนจำนวนเบิก', my: 'ထုတ်ယူအရေအတွက်ထည့်' },
    'tr.transfer_qty_hint': { zh: '输入调拨数量', en: 'Enter transfer qty', th: 'ป้อนจำนวนโอน', my: 'လွှဲပြောင်းအရေအတွက်ထည့်' },
    'lm.move_qty_hint': { zh: '输入移动数量', en: 'Enter move qty', th: 'ป้อนจำนวนย้าย', my: 'ရွှေ့ပြောင်းအရေအတွက်ထည့်' },
    'lm.load_hint': { zh: '输入移库单号或扫描条码...', en: 'Enter move doc no. or scan...', th: 'ป้อนเลขที่ใบย้ายหรือสแกน...', my: 'ရွှေ့ပြောင်းစာအမှတ် သို့ စကင်...' },
    'lm.scan_item_hint': { zh: '扫描物料条码...', en: 'Scan item barcode...', th: 'สแกนบาร์โค้ดสินค้า...', my: 'ပစ္စည်းဘားကုဒ်စကင်...' },
    'lm.from_bin_hint': { zh: '输入或扫描源库位', en: 'Enter or scan source bin', th: 'ป้อนหรือสแกนตำแหน่งต้นทาง', my: 'ရင်းမြစ်တည်နေရာထည့် သို့ စကင်' },
    'lm.to_bin_hint': { zh: '输入或扫描目标库位', en: 'Enter or scan target bin', th: 'ป้อนหรือสแกนตำแหน่งปลายทาง', my: 'ပစ်မှတ်တည်နေရာထည့် သို့ စကင်' },

    // 扫码格式提示 (各模块 form-hint)
    'po.scan_format_hint': { zh: '输入SAP采购订单号或扫描PO条码', en: 'Enter SAP PO number or scan PO barcode', th: 'ป้อนเลขที่ PO หรือสแกนบาร์โค้ด PO', my: 'SAP PO နံပါတ် သို့ PO ဘားကုဒ်စကင်' },
    'wo.scan_format_hint': { zh: '输入SAP生产订单号或扫描WO条码', en: 'Enter SAP WO number or scan WO barcode', th: 'ป้อนเลขที่ WO หรือสแกนบาร์โค้ด WO', my: 'SAP WO နံပါတ် သို့ WO ဘားကုဒ်စကင်' },
    'so.scan_format_hint': { zh: '输入SAP销售订单号或扫描SO条码', en: 'Enter SAP SO number or scan SO barcode', th: 'ป้อนเลขที่ SO หรือสแกนบาร์โค้ด SO', my: 'SAP SO နံပါတ် သို့ SO ဘားကုဒ်စကင်' },
    'pi.scan_format_hint': { zh: '输入SAP生产订单号或扫描PI条码', en: 'Enter SAP order number or scan PI barcode', th: 'ป้อนเลขที่คำสั่งหรือสแกนบาร์โค้ด PI', my: 'SAP မှာစာနံပါတ် သို့ PI ဘားကုဒ်စကင်' },
    'tr.scan_format_hint': { zh: '输入SAP调拨申请号或扫描TR条码', en: 'Enter SAP TR number or scan TR barcode', th: 'ป้อนเลขที่ TR หรือสแกนบาร์โค้ด TR', my: 'SAP TR နံပါတ် သို့ TR ဘားကုဒ်စကင်' },
    'field.date_format_hint': { zh: 'YYYYMMDD格式，默认当天', en: 'YYYYMMDD format, defaults to today', th: 'รูปแบบ YYYYMMDD ค่าเริ่มต้นวันนี้', my: 'YYYYMMDD ပုံစံ၊ ပုံသေယနေ့' },
    'field.batch_placeholder': { zh: '扫描或输入批次号', en: 'Scan or enter batch number', th: 'สแกนหรือป้อนเลขล็อต', my: 'အသုတ်နံပါတ်စကင် သို့ ထည့်' },
    'field.prod_date_placeholder': { zh: '如 20260212', en: 'e.g. 20260212', th: 'เช่น 20260212', my: 'ဥပမာ 20260212' },
    'field.dd_source_doc': { zh: 'DD原单号', en: 'DD Source Doc', th: 'เอกสาร DD ต้นทาง', my: 'DD မူရင်းစာရွက်' },

    // 摄像头扫码兜底 (camera-fallback.js)
    'camera.enabled': { zh: '\ud83d\udcf7 摄像头扫码已开启', en: '\ud83d\udcf7 Camera scanner enabled', th: '\ud83d\udcf7 เปิดสแกนกล้องแล้ว', my: '\ud83d\udcf7 ကင်မရာစကင်ဖွင့်ပြီ' },
    'camera.disabled': { zh: '\ud83d\udcf7 摄像头扫码已关闭', en: '\ud83d\udcf7 Camera scanner disabled', th: '\ud83d\udcf7 ปิดสแกนกล้องแล้ว', my: '\ud83d\udcf7 ကင်မရာစကင်ပိတ်ပြီ' },
    'camera.denied': { zh: '摄像头权限被拒绝，请在浏览器设置中允许，或继续使用键盘录入', en: 'Camera permission denied. Allow in browser settings, or use keyboard input.', th: 'สิทธิ์กล้องถูกปฏิเสธ กรุณาอนุญาตในเบราว์เซอร์ หรือใช้คีย์บอร์ด', my: 'ကင်မရာခွင့်ပြုချက်ငြင်းဆိုပြီ၊ ကီးဘုတ်ဖြင့်ဆက်သုံးပါ' },
    'camera.notFound': { zh: '未检测到摄像头设备，请继续使用键盘录入', en: 'No camera found. Use keyboard input.', th: 'ไม่พบกล้อง กรุณาใช้คีย์บอร์ด', my: 'ကင်မရာမတွေ့ပါ၊ ကီးဘုတ်ဖြင့်ဆက်သုံးပါ' },
    'camera.busy': { zh: '摄像头被其他应用占用，请关闭后重试', en: 'Camera in use by another app. Close it and retry.', th: 'กล้องถูกใช้งานอยู่ กรุณาปิดแล้วลองใหม่', my: 'ကင်မရာအခြားအက်ပ်သုံးနေသည်၊ ပိတ်ပြီးထပ်စမ်းပါ' },
    'camera.error': { zh: '摄像头启动失败，请继续使用键盘录入', en: 'Camera failed to start. Use keyboard input.', th: 'เปิดกล้องไม่สำเร็จ กรุณาใช้คีย์บอร์ด', my: 'ကင်မရာဖွင့်မရပါ၊ ကီးဘုတ်ဖြင့်ဆက်သုံးပါ' },
    'camera.libNotReady': { zh: '扫码库未加载，请刷新页面', en: 'Scanner library not loaded. Refresh page.', th: 'ไลบรารีสแกนยังไม่โหลด กรุณารีเฟรช', my: 'စကင်လိုက်ဘရာရီမတင်ရသေးပါ၊ စာမျက်နှာပြန်ဖွင့်ပါ' },
    'camera.requireHttps': { zh: '摄像头需要 HTTPS 环境', en: 'Camera requires HTTPS', th: 'กล้องต้องใช้ HTTPS', my: 'ကင်မရာ HTTPS လိုအပ်သည်' },
    'camera.scanHint': { zh: '将条码/二维码对准框内', en: 'Align barcode/QR code within frame', th: 'จัดบาร์โค้ด/QR โค้ดให้อยู่ในกรอบ', my: 'ဘားကုဒ်/QR ကုဒ်ကိုဘောင်ထဲထည့်ပါ' },
    'camera.close': { zh: '关闭', en: 'Close', th: 'ปิด', my: 'ပိတ်' },
    'camera.torchOn': { zh: '\ud83d\udd26 关灯', en: '\ud83d\udd26 Light Off', th: '\ud83d\udd26 ปิดไฟ', my: '\ud83d\udd26 မီးပိတ်' },
    'camera.torchOff': { zh: '\ud83d\udd26 开灯', en: '\ud83d\udd26 Light On', th: '\ud83d\udd26 เปิดไฟ', my: '\ud83d\udd26 မီးဖွင့်' },
    'camera.torchUnsupported': { zh: '当前设备不支持控制闪光灯', en: 'Torch not supported on this device', th: 'อุปกรณ์นี้ไม่รองรับแฟลช', my: 'ဤစက်သည်ဖလက်ရှ်ကိုမပံ့ပိုးပါ' },

    // ---- 软键盘切换 (移动端) ----
    'keyboard.toggle': { zh: '切换软键盘', en: 'Toggle keyboard', th: 'สลับแป้นพิมพ์', my: 'ကီးဘုတ်ဖွင့်/ပိတ်' },
    'keyboard.enabled': { zh: '⌨ 软键盘已开启', en: '⌨ Keyboard enabled', th: '⌨ เปิดแป้นพิมพ์แล้ว', my: '⌨ ကီးဘုတ်ဖွင့်ပြီ' },
    'keyboard.disabled': { zh: '⌨ 软键盘已关闭', en: '⌨ Keyboard hidden', th: '⌨ ปิดแป้นพิมพ์แล้ว', my: '⌨ ကီးဘုတ်ပိတ်ပြီ' },

    // ---- OMS 订单管理 ----
    'doctype.DD': { zh: '配送单', en: 'Delivery Doc', th: 'ใบส่งสินค้า', my: 'ပို့ဆောင်စာ' },
    'doctype.DD.sub': { zh: '配送拣货', en: 'Delivery Pick', th: 'หยิบส่ง', my: 'ပို့ဆောင်ကောက်' },

    // OMS 页面
    'oms.title': { zh: 'OMS 订单管理', en: 'OMS Order Management', th: 'OMS จัดการคำสั่งซื้อ', my: 'OMS မှာစာစီမံ' },
    'oms.subtitle': { zh: '订单查询、DD拆单、批量打印', en: 'Order query, DD split, batch print', th: 'ค้นหาคำสั่ง, แยก DD, พิมพ์กลุ่ม', my: 'မှာစာရှာ, DD ခွဲ, အစုလိုက်ပုံနှိပ်' },
    'oms.query': { zh: '查询', en: 'Query', th: 'ค้นหา', my: 'ရှာဖွေ' },
    'oms.reset': { zh: '重置', en: 'Reset', th: 'รีเซ็ต', my: 'ပြန်လည်သတ်မှတ်' },
    'oms.order_info': { zh: '订单信息', en: 'Order Info', th: 'ข้อมูลคำสั่งซื้อ', my: 'မှာစာအချက်အလက်' },
    'oms.line_items': { zh: '行项目', en: 'Line Items', th: 'รายการ', my: 'အတန်းများ' },
    'oms.history': { zh: '操作历史', en: 'History', th: 'ประวัติ', my: 'မှတ်တမ်း' },

    // OMS 搜索面板
    'oms.search_type': { zh: '单据类型', en: 'Doc Type', th: 'ประเภทเอกสาร', my: 'စာရွက်အမျိုးအစား' },
    'oms.search_bp': { zh: '客商代码', en: 'BP Code', th: 'รหัสคู่ค้า', my: 'လုပ်ငန်းကုဒ်' },
    'oms.search_bp_name': { zh: '客商名称', en: 'BP Name', th: 'ชื่อคู่ค้า', my: 'လုပ်ငန်းအမည်' },
    'oms.search_doc_num': { zh: '单号', en: 'Doc No.', th: 'เลขที่เอกสาร', my: 'စာရွက်အမှတ်' },
    'oms.search_status': { zh: 'OMS状态', en: 'OMS Status', th: 'สถานะ OMS', my: 'OMS အခြေအနေ' },
    'oms.search_date_from': { zh: '开始日期', en: 'From Date', th: 'จากวันที่', my: 'မှရက်စွဲ' },
    'oms.search_date_to': { zh: '结束日期', en: 'To Date', th: 'ถึงวันที่', my: 'ထိရက်စွဲ' },

    // OMS 表格列头
    'oms.col_select': { zh: '选择', en: 'Select', th: 'เลือก', my: 'ရွေး' },
    'oms.col_expand': { zh: '展开', en: 'Expand', th: 'ขยาย', my: 'ချဲ့' },
    'oms.col_type': { zh: '类型', en: 'Type', th: 'ประเภท', my: 'အမျိုးအစား' },
    'oms.col_doc_num': { zh: '单号', en: 'Doc No.', th: 'เลขที่', my: 'အမှတ်' },
    'oms.col_bp': { zh: '客商', en: 'BP', th: 'คู่ค้า', my: 'လုပ်ငန်း' },
    'oms.col_bp_desc': { zh: '客商/物料描述', en: 'BP/Desc', th: 'คู่ค้า/รายละเอียด', my: 'လုပ်ငန်း/ဖော်ပြချက်' },
    'oms.col_date': { zh: '日期', en: 'Date', th: 'วันที่', my: 'ရက်စွဲ' },
    'oms.col_status': { zh: 'OMS状态', en: 'OMS Status', th: 'สถานะ OMS', my: 'OMS အခြေအနေ' },
    'oms.col_exec': { zh: '执行', en: 'Exec', th: 'ดำเนินการ', my: 'လုပ်ဆောင်' },
    'oms.col_completion': { zh: '完成率', en: 'Completion', th: 'เสร็จสมบูรณ์', my: 'ပြီးစီးမှု' },
    'oms.col_amount': { zh: '金额', en: 'Amount', th: 'จำนวนเงิน', my: 'ပမာဏ' },
    'oms.col_container': { zh: '柜号', en: 'Container', th: 'เลขตู้', my: 'ကွန်တိန်နာ' },
    'oms.col_actual_qty': { zh: '已处理', en: 'Actual', th: 'จำนวนจริง', my: 'အမှန်အရေအတွက်' },
    'oms.col_item_code': { zh: '物料号', en: 'Item', th: 'รหัสสินค้า', my: 'ပစ္စည်းကုဒ်' },
    'oms.issued_qty': { zh: '已发数量', en: 'Issued', th: 'จำนวนที่จ่าย', my: 'ထုတ်ပေးပြီး' },
    'oms.wo_summary': { zh: '汇总', en: 'Summary', th: 'สรุป', my: 'အကျဉ်းချုပ်' },

    // OMS 状态
    'oms.status_pending': { zh: '待处理', en: 'Pending', th: 'รอดำเนินการ', my: 'စောင့်ဆိုင်း' },
    'oms.status_in_progress': { zh: '进行中', en: 'In Progress', th: 'กำลังดำเนินการ', my: 'ဆောင်ရွက်နေ' },
    'oms.line_partial': { zh: '部分完成', en: 'Partial', th: 'บางส่วน', my: 'တစ်စိတ်တစ်ပိုင်း' },
    'oms.status_completed': { zh: '已完成', en: 'Completed', th: 'เสร็จสิ้น', my: 'ပြီးစီး' },
    'oms.status_split': { zh: '已拆分', en: 'Split', th: 'แยกแล้ว', my: 'ခွဲပြီး' },
    'oms.status_exported': { zh: '已导出', en: 'Exported', th: 'ส่งออกแล้ว', my: 'ပို့ပြီး' },
    'oms.status_cancelled': { zh: '已取消', en: 'Cancelled', th: 'ยกเลิก', my: 'ပယ်ဖျက်ပြီး' },
    'oms.exec_idle': { zh: '未开始', en: 'Idle', th: 'ยังไม่เริ่ม', my: 'မစတင်သေး' },
    'oms.exec_executing': { zh: '执行中', en: 'Executing', th: 'กำลังดำเนินการ', my: 'ဆောင်ရွက်နေ' },
    'oms.exec_done': { zh: '已完成', en: 'Done', th: 'เสร็จ', my: 'ပြီးပြီ' },

    // OMS 订单详情
    'oms.due_date': { zh: '交期', en: 'Due Date', th: 'กำหนดส่ง', my: 'သတ်မှတ်ရက်' },
    'oms.item_code': { zh: '物料编码', en: 'Item Code', th: 'รหัสสินค้า', my: 'ပစ္စည်းကုဒ်' },
    'oms.item_name': { zh: '物料名称', en: 'Item Name', th: 'ชื่อสินค้า', my: 'ပစ္စည်းအမည်' },
    'oms.qty': { zh: '数量', en: 'Qty', th: 'จำนวน', my: 'အရေအတွက်' },
    'oms.warehouse': { zh: '仓库', en: 'Warehouse', th: 'คลังสินค้า', my: 'ဂိုဒေါင်' },

    // OMS DD 拆单
    'oms.dd_title': { zh: 'DD 拆单', en: 'DD Split', th: 'แยก DD', my: 'DD ခွဲ' },
    'oms.dd_create': { zh: '创建DD', en: 'Create DD', th: 'สร้าง DD', my: 'DD ဖန်တီး' },
    'oms.dd_add': { zh: '添加DD', en: 'Add DD', th: 'เพิ่ม DD', my: 'DD ထပ်ထည့်' },
    'oms.dd_remove': { zh: '删除DD', en: 'Remove DD', th: 'ลบ DD', my: 'DD ဖျက်' },
    'oms.dd_container': { zh: '装柜号', en: 'Container No.', th: 'เลขตู้', my: 'ကွန်တိန်နာအမှတ်' },
    'oms.dd_container_hint': { zh: '输入装柜号 (英文数字)', en: 'Enter container no.', th: 'ป้อนเลขตู้', my: 'ကွန်တိန်နာအမှတ်ထည့်' },
    'oms.dd_split_summary': { zh: '拆分汇总', en: 'Split Summary', th: 'สรุปการแยก', my: 'ခွဲခြမ်းအကျဉ်းချုပ်' },
    'oms.dd_allocated': { zh: '已分配', en: 'Allocated', th: 'จัดสรรแล้ว', my: 'ခွဲဝေပြီး' },
    'oms.dd_remaining': { zh: '剩余', en: 'Remaining', th: 'คงเหลือ', my: 'ကျန်ရှိ' },
    'oms.dd_total': { zh: '总计', en: 'Total', th: 'รวม', my: 'စုစုပေါင်း' },
    'oms.dd_submit': { zh: '提交拆单', en: 'Submit Split', th: 'ยืนยันแยก', my: 'ခွဲခြမ်းတင်ပို့' },
    'oms.dd_confirm': { zh: '确认拆分为 {0} 个DD?', en: 'Confirm split into {0} DDs?', th: 'ยืนยันแยกเป็น {0} DD?', my: '{0} DD ခွဲမည်အတည်ပြု?' },
    'oms.dd_locked': { zh: '该订单仓库已开始作业，禁止拆单', en: 'Order already in WMS execution, split forbidden', th: 'คำสั่งกำลังดำเนินการใน WMS ห้ามแยก', my: 'WMS လုပ်ဆောင်နေပြီ ခွဲခွင့်မပြု' },
    'oms.dd_qty_mismatch': { zh: '分配数量不等于计划数量', en: 'Allocated qty != planned qty', th: 'จำนวนจัดสรร ≠ จำนวนแผน', my: 'ခွဲဝေအရေအတွက် ≠ စီစဉ်အရေအတွက်' },
    'oms.dd_no_alloc': { zh: '请至少分配一个物料', en: 'Allocate at least one item', th: 'จัดสรรอย่างน้อย 1 สินค้า', my: 'အနည်းဆုံးပစ္စည်း 1 ခုခွဲဝေပါ' },
    'oms.dd_children': { zh: 'DD子单', en: 'DD Children', th: 'DD ย่อย', my: 'DD အခွဲ' },
    'oms.col_dd_refs': { zh: 'DD关联', en: 'DD Refs', th: 'อ้างอิง DD', my: 'DD ရည်ညွှန်း' },
    'oms.col_source_line': { zh: '源行号', en: 'Src Line', th: 'บรรทัดต้นทาง', my: 'မူရင်းအတန်း' },
    'oms.source_order': { zh: '源单', en: 'Source', th: 'ต้นทาง', my: 'မူရင်း' },
    'oms.dd_lineage': { zh: 'DD谱系', en: 'DD Lineage', th: 'DD สายตระกูล', my: 'DD မျိုးနွယ်' },
    'oms.dd_add_short': { zh: '添加DD', en: 'Add DD', th: 'เพิ่ม DD', my: 'DD ထပ်ထည့်' },
    'oms.dd_remove_short': { zh: '删除', en: 'Remove', th: 'ลบ', my: 'ဖျက်' },
    'oms.dd_split_even': { zh: '均分到各DD', en: 'Split Evenly', th: 'แบ่งเท่าๆ', my: 'ညီမျှခွဲဝေ' },
    'oms.dd_count': { zh: 'DD数', en: 'DD Count', th: 'จำนวน DD', my: 'DD အရေအတွက်' },
    'oms.dd_fill_remaining': { zh: '将剩余数量全部填入此DD', en: 'Fill all remaining into this DD', th: 'เติมจำนวนที่เหลือทั้งหมดใน DD นี้', my: 'ကျန်ရှိသမျှ ဤ DD ထဲထည့်' },
    'oms.dd_fill_btn': { zh: '填充剩余', en: 'Fill Rest', th: 'เติมที่เหลือ', my: 'ကျန်ဖြည့်' },
    'oms.dd_all_allocated': { zh: '所有物料已分配完成', en: 'All items fully allocated', th: 'จัดสรรสินค้าทั้งหมดแล้ว', my: 'ပစ္စည်းအားလုံးခွဲဝေပြီး' },
    'oms.loading_lines': { zh: '正在加载订单明细...', en: 'Loading order lines...', th: 'กำลังโหลดรายการ...', my: 'မှာစာအသေးစိတ်ဖတ်နေ...' },
    'oms.no_lines': { zh: '该订单没有行项目', en: 'No line items for this order', th: 'ไม่มีรายการในคำสั่งนี้', my: 'ဤမှာစာတွင်အတန်းမရှိ' },
    'oms.line_count': { zh: '物料', en: 'Items', th: 'สินค้า', my: 'ပစ္စည်း' },
    'oms.items_unit': { zh: '项', en: 'items', th: 'รายการ', my: 'ခု' },

    // DD 看板 (v0.1.15)
    'oms.dd_search_placeholder': { zh: '搜索物料号/名称...', en: 'Search item code/name...', th: 'ค้นหารหัส/ชื่อสินค้า...', my: 'ပစ္စည်းကုဒ်/နာမည်ရှာ...' },
    'oms.dd_submitting': { zh: '提交中...', en: 'Submitting...', th: 'กำลังส่ง...', my: 'တင်ပို့နေ...' },
    'oms.dd_pool_title': { zh: '待分配', en: 'Unallocated', th: 'ยังไม่จัดสรร', my: 'မခွဲဝေရသေး' },
    'oms.dd_drop_hint': { zh: '拖拽物料到此柜', en: 'Drag items here', th: 'ลากสินค้ามาที่นี่', my: 'ပစ္စည်းဆွဲထည့်' },
    'oms.dd_gross_weight': { zh: '毛重', en: 'G.W.', th: 'น้ำหนักรวม', my: 'အလေးချိန်' },
    'oms.dd_no_container': { zh: '请至少创建一个DD', en: 'Create at least one DD', th: 'สร้าง DD อย่างน้อย 1', my: 'DD အနည်းဆုံး 1 ခုဖန်တီးပါ' },
    'oms.dd_container_empty': { zh: '请填写所有DD的柜号', en: 'Fill all container numbers', th: 'กรอกเลขตู้ทั้งหมด', my: 'ကွန်တိန်နာနံပါတ်အားလုံးဖြည့်ပါ' },
    'oms.dd_container_dup': { zh: '柜号不能重复', en: 'Duplicate container number', th: 'เลขตู้ซ้ำ', my: 'ကွန်တိန်နာနံပါတ်ထပ်နေ' },
    'oms.dd_single_no_change': { zh: '只有一个柜子且数量未删减，无需拆单，请直接使用SO作业', en: 'Only 1 container with no qty change. Use SO directly instead of DD split.', th: 'มีแค่ตู้เดียวและไม่ลดจำนวน ใช้ SO โดยตรง', my: 'ကွန်တိန်နာ 1 လုံးသာ အရေအတွက်မပြောင်း SO တိုက်ရိုက်သုံးပါ' },
    'oms.dd_warehouse_mismatch': { zh: '不同仓库的SO不允许合并创建DD', en: 'Cannot merge SOs from different warehouses into one DD', th: 'ไม่สามารถรวม SO จากคลังต่างกัน', my: 'မတူညီသောဂိုဒေါင်မှ SO များ DD ပေါင်း၍မရ' },
    'oms.dd_no_items': { zh: '没有分配物料到容器', en: 'No items allocated to containers', th: 'ไม่มีสินค้าจัดสรรให้ตู้', my: 'ကွန်တိန်နာထဲ ပစ္စည်းမခွဲဝေရသေး' },
    'oms.dd_partial_confirm': { zh: '有物料尚未全部分配，确定提交？', en: 'Some items not fully allocated. Submit anyway?', th: 'บางสินค้ายังไม่จัดสรรครบ ส่งต่อ?', my: 'ပစ္စည်းအချို့ မခွဲဝေရသေး တင်ပို့မည်?' },
    'oms.dd_single_only': { zh: 'DD拆单仅支持单个SO，当前已选 {0} 个', en: 'DD split supports single SO only, {0} selected', th: 'แยก DD รองรับ SO เดียว เลือกแล้ว {0}', my: 'DD ခွဲခြမ်းက SO တစ်ခုသာ {0} ခုရွေးထား' },
    'oms.dd_already_split': { zh: '该订单已拆分DD，不能重复创建', en: 'Order already split into DD, cannot create again', th: 'คำสั่งแยก DD แล้ว ไม่สามารถสร้างซ้ำ', my: 'DD ခွဲပြီးသားမှာစာ ထပ်ဖန်တီးမရ' },

    // OMS 打印
    'oms.print_order': { zh: '打印订单', en: 'Print Order', th: 'พิมพ์คำสั่ง', my: 'မှာစာပုံနှိပ်' },
    'oms.print_barcode': { zh: '打印条码', en: 'Print Barcode', th: 'พิมพ์บาร์โค้ด', my: 'ဘားကုဒ်ပုံနှိပ်' },
    'oms.print_summary': { zh: '订单汇总打印', en: 'Order Summary Print', th: 'พิมพ์สรุปคำสั่ง', my: 'မှာစာအကျဉ်းပုံနှိပ်' },

    // OMS 同步
    'oms.sync_title': { zh: 'OMS订单同步', en: 'OMS Order Sync', th: 'ซิงค์คำสั่ง OMS', my: 'OMS မှာစာချိန်ညှိ' },
    'sync.oms_po_btn': { zh: '采购订单', en: 'Purchase Orders', th: 'ใบสั่งซื้อ', my: 'ဝယ်ယူမှာစာ' },
    'sync.oms_wo_btn': { zh: '生产订单', en: 'Work Orders', th: 'ใบสั่งผลิต', my: 'ထုတ်လုပ်မှာစာ' },
    'sync.oms_so_btn': { zh: '销售订单', en: 'Sales Orders', th: 'คำสั่งขาย', my: 'အရောင်းမှာစာ' },
    'sync.oms_tr_btn': { zh: '调拨订单', en: 'Transfer Orders', th: 'ใบโอน', my: 'လွှဲပြောင်းမှာစာ' },
    'sync.oms_syncing': { zh: '同步中...', en: 'Syncing...', th: 'กำลังซิงค์...', my: 'ချိန်ညှိနေသည်...' },
    'sync.oms_done': { zh: 'OMS订单同步完成', en: 'OMS orders synced', th: 'ซิงค์คำสั่ง OMS เสร็จ', my: 'OMS မှာစာချိန်ညှိပြီး' },
    'sync.oms_btn': { zh: '\u{1F4DC} 同步OMS订单', en: '\u{1F4DC} Sync OMS Orders', th: '\u{1F4DC} ซิงค์คำสั่ง OMS', my: '\u{1F4DC} OMS မှာစာချိန်ညှိ' },

    // OMS 导航磁贴
    'tool.oms': { zh: '订单管理', en: 'Order Mgmt', th: 'จัดการคำสั่ง', my: 'မှာစာစီမံ' },
    'tool.oms.sub': { zh: 'OMS', en: 'OMS', th: 'OMS', my: 'OMS' },

    // OMS 分页
    'oms.page_info': { zh: '第 {0} / {1} 页', en: 'Page {0}/{1}', th: 'หน้า {0}/{1}', my: 'စာမျက်နှာ {0}/{1}' },
    'oms.total_records': { zh: '条', en: 'records', th: 'รายการ', my: 'ခု' },
    'oms.page_size': { zh: '{0}条/页', en: '{0}/page', th: '{0}/หน้า', my: '{0}/စာမျက်နှာ' },
    'oms.page_20': { zh: '20条/页', en: '20/page', th: '20/หน้า', my: '20/စာမျက်နှာ' },
    'oms.page_50': { zh: '50条/页', en: '50/page', th: '50/หน้า', my: '50/စာမျက်နှာ' },
    'oms.page_100': { zh: '100条/页', en: '100/page', th: '100/หน้า', my: '100/စာမျက်နှာ' },
    'oms.doc_num_batch_hint': { zh: '单号（空格分隔批量，最多50个）', en: 'Doc No. (space-separated batch, max 50)', th: 'เลขที่ (เว้นวรรค สูงสุด 50)', my: 'စာရွက်အမှတ် (space ခြား အများဆုံး 50)' },
    'oms.bp_placeholder': { zh: '客商代码', en: 'BP Code', th: 'รหัสคู่ค้า', my: 'လုပ်ငန်းကုဒ်' },
    'oms.bp_name_placeholder': { zh: '客商名称', en: 'BP Name', th: 'ชื่อคู่ค้า', my: 'လုပ်ငန်းအမည်' },
    'oms.warehouse_placeholder': { zh: '仓库代码', en: 'WH Code', th: 'รหัสคลัง', my: 'ဂိုဒေါင်ကုဒ်' },
    'oms.container_placeholder': { zh: '柜号', en: 'Container No', th: 'เลขตู้', my: 'ကွန်တိန်နာနံပါတ်' },

    // OMS 通用操作
    'oms.select_all': { zh: '全选', en: 'Select All', th: 'เลือกทั้งหมด', my: 'အားလုံးရွေး' },
    'oms.deselect_all': { zh: '取消全选', en: 'Deselect All', th: 'ยกเลิกทั้งหมด', my: 'အားလုံးဖယ်' },
    'oms.no_selection': { zh: '请先选择订单', en: 'Select orders first', th: 'เลือกคำสั่งก่อน', my: 'မှာစာရွေးပါ' },
    'oms.type_all': { zh: '全部类型', en: 'All Types', th: 'ทุกประเภท', my: 'အားလုံး' },
    'oms.status_all': { zh: '全部状态', en: 'All Status', th: 'ทุกสถานะ', my: 'အားလုံး' },

    // SAP 状态标签
    'oms.search_sap_status': { zh: 'SAP状态', en: 'SAP Status', th: 'สถานะ SAP', my: 'SAP အခြေအနေ' },
    'oms.col_sap_status': { zh: 'SAP状态', en: 'SAP Status', th: 'สถานะ SAP', my: 'SAP အခြေအနေ' },
    'oms.sap_status_all': { zh: '全部', en: 'All', th: 'ทั้งหมด', my: 'အားလုံး' },
    'oms.sap_status_open': { zh: '打开', en: 'Open', th: 'เปิด', my: 'ဖွင့်' },
    'oms.sap_status_planned': { zh: '计划', en: 'Planned', th: 'วางแผน', my: 'စီစဉ်' },
    'oms.sap_status_released': { zh: '已释放', en: 'Released', th: 'ปล่อยแล้ว', my: 'ထုတ်ပြန်' },
    'oms.sap_status_closed': { zh: '已关闭', en: 'Closed', th: 'ปิดแล้ว', my: 'ပိတ်' },
    'oms.sap_status_cancelled': { zh: '已取消', en: 'Cancelled', th: 'ยกเลิก', my: 'ပယ်ဖျက်' },
    'oms.sap_status_none': { zh: '未选择', en: 'None', th: 'ไม่ได้เลือก', my: 'မရွေးပါ' },

    // SO DD 页面动态标题
    'so.dd_title': { zh: '配送单拣货 (DD)', en: 'Delivery Pick (DD)', th: 'หยิบส่ง (DD)', my: 'ပို့ဆောင်ကောက်ယူ (DD)' },
    'so.dd_subtitle': { zh: '扫描或输入配送单号，执行拣货操作', en: 'Scan or enter DD number to pick', th: 'สแกนหรือป้อน DD เพื่อหยิบ', my: 'DD နံပါတ်ထည့်၍ ကောက်ယူ' },

    // P3d 新增
    'oms.search_warehouse': { zh: '仓库', en: 'Warehouse', th: 'คลังสินค้า', my: 'ဂိုဒေါင်' },
    'oms.search_container': { zh: '柜号', en: 'Container', th: 'เลขตู้', my: 'ကွန်တိန်နာ' },
    'sync.force_enabled': { zh: '已强制启用', en: 'Force Enabled', th: 'เปิดใช้งานบังคับ', my: 'အတင်း ဖွင့်ထားသည်' },
    'sync.check_failed_retry': { zh: '状态检查失败，点击面板标题重试', en: 'Check failed, tap panel title to retry', th: 'ตรวจสอบล้มเหลว แตะหัวข้อเพื่อลองใหม่', my: 'စစ်ဆေးမှု မအောင်မြင်ပါ၊ ခေါင်းစဉ်ကို နှိပ်၍ ပြန်စမ်းပါ' },
    'oms.dd_unallocated': { zh: '以下物料未完全分配: ', en: 'Unallocated items: ', th: 'รายการที่ยังไม่จัดสรร: ', my: 'မခွဲဝေရသေးသော ပစ္စည်းများ: ' },

    // ---- 模块短名称 (用于拼接消息) ----
    'common.doc': { zh: '单', en: ' doc', th: '', my: '' },
    'ic.title_short': { zh: '盘点', en: 'Count', th: 'นับ', my: 'စစ်ဆေး' },
    'lm.title_short': { zh: '移库', en: 'Move', th: 'ย้าย', my: 'ရွှေ့' },

    // ---- 操作确认/结果消息 (各模块通用) ----
    'confirm.receipt': { zh: '确认收货 {0} {1}?', en: 'Confirm receipt {0} {1}?', th: 'ยืนยันรับ {0} {1}?', my: 'လက်ခံအတည်ပြု {0} {1}?' },
    'confirm.pick': { zh: '确认拣货 {0} {1}?', en: 'Confirm pick {0} {1}?', th: 'ยืนยันหยิบ {0} {1}?', my: 'ကောက်ယူအတည်ပြု {0} {1}?' },
    'confirm.transfer': { zh: '确认调拨 {0} {1}?', en: 'Confirm transfer {0} {1}?', th: 'ยืนยันโอน {0} {1}?', my: 'လွှဲပြောင်းအတည်ပြု {0} {1}?' },
    'confirm.issue': { zh: '确认发料 {0} {1}?', en: 'Confirm issue {0} {1}?', th: 'ยืนยันจ่าย {0} {1}?', my: 'ထုတ်ပေးအတည်ပြု {0} {1}?' },
    'confirm.submit_rows': { zh: '确认提交 {0} 行{1}记录?', en: 'Confirm submit {0} {1} rows?', th: 'ยืนยันส่ง {0} แถว{1}?', my: '{0} အတန်း{1}တင်ပို့အတည်ပြု?' },
    'confirm.clear_pending': { zh: '确定清空所有待提交记录 ({0} 行)?', en: 'Clear all pending records ({0} rows)?', th: 'ล้างรายการทั้งหมด ({0} แถว)?', my: 'စောင့်ဆိုင်းမှတ်တမ်းအားလုံးရှင်း ({0} အတန်း)?' },
    'confirm.delete_item': { zh: '删除: {0}?', en: 'Delete: {0}?', th: 'ลบ: {0}?', my: 'ဖျက်: {0}?' },
    'confirm.complete_doc': { zh: '确认完成{0} {1}?', en: 'Confirm complete {0} {1}?', th: 'ยืนยันเสร็จสิ้น{0} {1}?', my: '{0} {1} ပြီးစီးအတည်ပြု?' },
    'confirm.complete_no_more': { zh: '确认完成{0} {1}? 完成后不可再添加记录。', en: 'Confirm complete {0} {1}? No more records can be added after.', th: 'ยืนยันเสร็จสิ้น{0} {1}? จะไม่สามารถเพิ่มรายการได้อีก', my: '{0} {1} ပြီးစီးအတည်ပြု? ပြီးရင်ထပ်ထည့်မရ' },
    'confirm.pending_then_complete': { zh: '有 {0} 行待提交记录，将先提交后完成{1} {2}。继续？', en: '{0} pending rows will be submitted first before completing {1} {2}. Continue?', th: 'มี {0} แถวรอส่ง จะส่งก่อนเสร็จสิ้น{1} {2} ดำเนินการต่อ?', my: '{0} အတန်းစောင့်ဆိုင်းနေ {1} {2} မတိုင်ခင်တင်ပို့မည် ဆက်လုပ်မည်?' },
    'confirm.mark_exported': { zh: '确认将 {0} 条记录标记为"已导出"?', en: 'Mark {0} records as exported?', th: 'ทำเครื่องหมาย {0} รายการเป็นส่งออกแล้ว?', my: '{0} မှတ်တမ်းကို ပို့ပြီးဟုအမှတ်ခြစ်မည်?' },
    'result.receipt_ok': { zh: '收货成功!', en: 'Receipt successful!', th: 'รับสินค้าสำเร็จ!', my: 'လက်ခံအောင်မြင်!' },
    'result.pick_ok': { zh: '拣货成功!', en: 'Pick successful!', th: 'หยิบสำเร็จ!', my: 'ကောက်ယူအောင်မြင်!' },
    'result.transfer_ok': { zh: '调拨成功!', en: 'Transfer successful!', th: 'โอนสำเร็จ!', my: 'လွှဲပြောင်းအောင်မြင်!' },
    'result.issue_ok': { zh: '发料成功!', en: 'Issue successful!', th: 'จ่ายสำเร็จ!', my: 'ထုတ်ပေးအောင်မြင်!' },
    'result.submit_failed': { zh: '提交失败', en: 'Submit failed', th: 'ส่งล้มเหลว', my: 'တင်ပို့မအောင်မြင်' },
    'result.submit_all_ok': { zh: '全部提交成功: {0} 行', en: 'All submitted: {0} rows', th: 'ส่งทั้งหมดสำเร็จ: {0} แถว', my: 'အားလုံးတင်ပို့ပြီး: {0} အတန်း' },
    'result.submit_partial': { zh: '提交完成: {0} 成功, {1} 失败', en: 'Done: {0} succeeded, {1} failed', th: 'เสร็จ: {0} สำเร็จ, {1} ล้มเหลว', my: 'ပြီး: {0} အောင်မြင်, {1} မအောင်မြင်' },
    'result.submit_error': { zh: '提交异常', en: 'Submit error', th: 'ข้อผิดพลาดในการส่ง', my: 'တင်ပို့ရာတွင်အမှား' },
    'result.partial_failed': { zh: '部分提交失败 ({0} 行)', en: 'Partial submit failed ({0} rows)', th: 'ส่งบางรายการล้มเหลว ({0} แถว)', my: 'တစ်စိတ်တစ်ပိုင်းတင်ပို့မအောင်မြင် ({0} အတန်း)' },
    'result.doc_completed': { zh: '{0}已完成', en: '{0} completed', th: '{0}เสร็จสิ้น', my: '{0}ပြီးစီး' },
    'result.marked_exported': { zh: '已标记 {0} 条记录为已导出', en: 'Marked {0} records as exported', th: 'ทำเครื่องหมาย {0} รายการแล้ว', my: '{0} မှတ်တမ်းအမှတ်ခြစ်ပြီး' },
    'msg.no_pending': { zh: '暂无待提交记录', en: 'No pending records', th: 'ไม่มีรายการรอส่ง', my: 'စောင့်ဆိုင်းမှတ်တမ်းမရှိ' },
    'msg.no_receipt_history': { zh: '暂无收货记录', en: 'No receipt records', th: 'ไม่มีประวัติรับ', my: 'လက်ခံမှတ်တမ်းမရှိ' },
    'msg.empty_pending': { zh: '暂存清单为空，请先添加记录', en: 'Pending list empty, add records first', th: 'รายการว่าง เพิ่มรายการก่อน', my: 'စောင့်ဆိုင်းစာရင်းအလွတ် မှတ်တမ်းထည့်ပါ' },
    'msg.enter_valid_qty': { zh: '请输入有效数量', en: 'Enter valid quantity', th: 'ป้อนจำนวนที่ถูกต้อง', my: 'မှန်ကန်သောအရေအတွက်ထည့်ပါ' },
    'msg.enter_operator': { zh: '请输入操作人', en: 'Enter operator name', th: 'ป้อนชื่อผู้ปฏิบัติงาน', my: 'လုပ်ဆောင်သူအမည်ထည့်ပါ' },
    'msg.enter_valid_receipt_qty': { zh: '请输入有效的收货数量', en: 'Enter valid receipt quantity', th: 'ป้อนจำนวนรับที่ถูกต้อง', my: 'မှန်ကန်သောလက်ခံအရေအတွက်ထည့်ပါ' },
    'msg.no_data_to_mark': { zh: '没有数据可标记', en: 'No data to mark', th: 'ไม่มีข้อมูลให้ทำเครื่องหมาย', my: 'အမှတ်ခြစ်ရန်ဒေတာမရှိ' },
    'label.processing': { zh: '处理中...', en: 'Processing...', th: 'กำลังดำเนินการ...', my: 'လုပ်ဆောင်နေသည်...' },

    // ---- JS showMessage / confirm 国际化 (v0.3.4) ----
    // 通用消息
    'msg.load_doc_first': { zh: '请先加载单据', en: 'Please load a document first', th: 'กรุณาโหลดเอกสารก่อน', my: 'စာရွက်စာတမ်းအရင်ဖွင့်ပါ' },
    'msg.load_order_first': { zh: '请先加载订单', en: 'Please load an order first', th: 'กรุณาโหลดคำสั่งซื้อก่อน', my: 'အော်ဒါအရင်ဖွင့်ပါ' },
    'msg.load_failed': { zh: '加载失败: {0}', en: 'Load failed: {0}', th: 'โหลดล้มเหลว: {0}', my: 'ဖွင့်မရ: {0}' },
    'msg.create_failed': { zh: '创建失败: {0}', en: 'Create failed: {0}', th: 'สร้างล้มเหลว: {0}', my: 'ဖန်တီးမရ: {0}' },
    'msg.item_match': { zh: '物料匹配: {0}', en: 'Item matched: {0}', th: 'สินค้าตรงกัน: {0}', my: 'ပစ္စည်းကိုက်ညီ: {0}' },
    'msg.item_mismatch': { zh: '物料不匹配! 当前订单: {0}, 扫描: {1}', en: 'Item mismatch! Order: {0}, Scanned: {1}', th: 'สินค้าไม่ตรง! คำสั่ง: {0}, สแกน: {1}', my: 'ပစ္စည်းမကိုက်! အော်ဒါ: {0}, စကင်: {1}' },
    'msg.order_closed': { zh: '订单已关闭，无法作业', en: 'Order closed, cannot operate', th: 'คำสั่งปิดแล้ว ดำเนินการไม่ได้', my: 'အော်ဒါပိတ်ပြီး လုပ်ဆောင်မရ' },
    'msg.line_closed': { zh: '该行已关闭，无法作业', en: 'Line closed, cannot operate', th: 'รายการปิดแล้ว ดำเนินการไม่ได้', my: 'အတန်းပိတ်ပြီး လုပ်ဆောင်မရ' },
    'msg.line_completed': { zh: '该行已完成，无法作业', en: 'Line completed, cannot operate', th: 'รายการเสร็จแล้ว ดำเนินการไม่ได้', my: 'အတန်းပြီးပြီ လုပ်ဆောင်မရ' },
    'msg.order_closed_no_receipt': { zh: '订单已关闭，无法收货', en: 'Order closed, cannot receive', th: 'คำสั่งปิดแล้ว รับไม่ได้', my: 'အော်ဒါပိတ်ပြီး လက်ခံမရ' },
    'msg.order_closed_no_pick': { zh: '订单已关闭，无法拣货', en: 'Order closed, cannot pick', th: 'คำสั่งปิดแล้ว หยิบไม่ได้', my: 'အော်ဒါပိတ်ပြီး ကောက်ယူမရ' },
    'msg.order_closed_no_issue': { zh: '订单已关闭，无法发料', en: 'Order closed, cannot issue', th: 'คำสั่งปิดแล้ว จ่ายไม่ได้', my: 'အော်ဒါပိတ်ပြီး ထုတ်ပေးမရ' },
    'msg.no_remaining': { zh: '没有剩余数量', en: 'No remaining quantity', th: 'ไม่มีจำนวนเหลือ', my: 'ကျန်အရေအတွက်မရှိ' },
    'msg.no_open_lines': { zh: '没有待处理的行项目', en: 'No open line items', th: 'ไม่มีรายการรอดำเนินการ', my: 'လုပ်ဆောင်ရန်အတန်းမရှိ' },
    'msg.fill_whs_and_user': { zh: '请填写仓库和操作人', en: 'Enter warehouse and operator', th: 'ป้อนคลังและผู้ปฏิบัติงาน', my: 'ဂိုဒေါင်နှင့်လုပ်ဆောင်သူထည့်ပါ' },
    'msg.fill_whs_and_counter': { zh: '请填写仓库和盘点人', en: 'Enter warehouse and counter', th: 'ป้อนคลังและผู้นับ', my: 'ဂိုဒေါင်နှင့်စစ်ဆေးသူထည့်ပါ' },
    'msg.whs_not_in_master': { zh: '仓库代码 [{0}] 不在主数据中，请重新输入', en: 'Warehouse [{0}] not in master data, re-enter', th: 'รหัสคลัง [{0}] ไม่อยู่ในข้อมูลหลัก', my: 'ဂိုဒေါင်ကုဒ် [{0}] မာစတာဒေတာတွင်မရှိ' },
    'msg.whs_not_in_cache': { zh: '仓库 {0} 不在主数据缓存中', en: 'Warehouse {0} not in cache', th: 'คลัง {0} ไม่อยู่ในแคช', my: 'ဂိုဒေါင် {0} ကက်ရှ်တွင်မရှိ' },
    'msg.bin_not_in_cache': { zh: '库位 {0} 不在主数据缓存中', en: 'Bin {0} not in cache', th: 'ตำแหน่ง {0} ไม่อยู่ในแคช', my: 'တည်နေရာ {0} ကက်ရှ်တွင်မရှိ' },
    'msg.bin_not_in_master': { zh: '库位代码 [{0}] 不在主数据中，请重新输入', en: 'Bin [{0}] not in master data, re-enter', th: 'ตำแหน่ง [{0}] ไม่อยู่ในข้อมูลหลัก', my: 'တည်နေရာ [{0}] မာစတာဒေတာတွင်မရှိ' },
    'msg.bin_dict_not_loaded': { zh: '库位字典未加载，无法校验库位 [{0}]，请刷新页面', en: 'Bin dict not loaded, cannot verify [{0}], refresh page', th: 'ไม่ได้โหลดพจนานุกรมตำแหน่ง ตรวจสอบ [{0}] ไม่ได้ กรุณารีเฟรช', my: 'တည်နေရာအဘိဓာန်မဖွင့်ရသေး [{0}] မစစ်ဆေးနိုင် စာမျက်နှာပြန်ဖွင့်ပါ' },
    'msg.enter_bin_first': { zh: '请先输入库位代码', en: 'Enter bin code first', th: 'ป้อนรหัสตำแหน่งก่อน', my: 'တည်နေရာကုဒ်အရင်ထည့်ပါ' },
    'msg.bin_already_in_dict': { zh: '库位 [{0}] 已在字典中', en: 'Bin [{0}] already in dictionary', th: 'ตำแหน่ง [{0}] อยู่ในพจนานุกรมแล้ว', my: 'တည်နေရာ [{0}] အဘိဓာန်တွင်ရှိပြီး' },
    'msg.bin_added_to_dict': { zh: '库位 [{0}] 已添加到字典', en: 'Bin [{0}] added to dictionary', th: 'เพิ่มตำแหน่ง [{0}] ในพจนานุกรมแล้ว', my: 'တည်နေရာ [{0}] အဘိဓာန်သို့ထည့်ပြီး' },
    'msg.bin_add_failed': { zh: '添加库位失败: {0}', en: 'Add bin failed: {0}', th: 'เพิ่มตำแหน่งล้มเหลว: {0}', my: 'တည်နေရာထည့်မရ: {0}' },
    'msg.scan_item_first': { zh: '请先扫描物料条码', en: 'Scan item barcode first', th: 'สแกนบาร์โค้ดสินค้าก่อน', my: 'ပစ္စည်းဘားကုဒ်အရင်စကင်ပါ' },
    'msg.sync_pending': { zh: '数据同步中，{0}秒后自动重试...', en: 'Syncing, auto-retry in {0}s...', th: 'กำลังซิงค์ ลองใหม่ใน {0}วิ...', my: 'ချိန်ကိုက်နေသည် {0}စက္ကန့်နောက်ပြန်ကြိုးစား...' },
    'msg.sync_timeout': { zh: '数据同步超时，请稍后手动重试', en: 'Sync timeout, please retry later', th: 'ซิงค์หมดเวลา ลองใหม่ภายหลัง', my: 'ချိန်ကိုက်အချိန်ကုန် နောက်မှပြန်ကြိုးစားပါ' },
    'msg.item_not_cached': { zh: '物料 {0} 未在缓存中找到，请等待同步', en: 'Item {0} not in cache, wait for sync', th: 'สินค้า {0} ไม่อยู่ในแคช รอซิงค์', my: 'ပစ္စည်း {0} ကက်ရှ်တွင်မတွေ့ ချိန်ကိုက်မှုစောင့်ပါ' },
    'msg.item_not_in_sap': { zh: '物料 {0} 未在SAP中找到，不允许操作', en: 'Item {0} not found in SAP, operation not allowed', th: 'สินค้า {0} ไม่พบใน SAP ดำเนินการไม่ได้', my: 'ပစ္စည်း {0} SAP တွင်မတွေ့ လုပ်ဆောင်ခွင့်မပြု' },
    'msg.item_query_failed': { zh: '物料 {0} 查询失败，请检查网络后重试', en: 'Item {0} query failed, check network', th: 'ค้นหาสินค้า {0} ล้มเหลว ตรวจสอบเครือข่าย', my: 'ပစ္စည်း {0} ရှာဖွေမရ ကွန်ရက်စစ်ဆေးပါ' },
    'msg.item_code_abnormal': { zh: '物料号异常 (可能两个条码被合并): {0}\n请重新扫描单个物料', en: 'Abnormal item code (possibly merged barcodes): {0}\nPlease rescan single item', th: 'รหัสสินค้าผิดปกติ (อาจรวมบาร์โค้ด): {0}\nกรุณาสแกนใหม่', my: 'ပစ္စည်းကုဒ်မမှန် (ဘားကုဒ်ပေါင်းမိနိုင်): {0}\nတစ်ခုတည်းပြန်စကင်ပါ' },
    'msg.query_failed': { zh: '查询失败: {0}', en: 'Query failed: {0}', th: 'ค้นหาล้มเหลว: {0}', my: 'ရှာဖွေမရ: {0}' },
    'msg.no_data_to_export': { zh: '没有可导出的数据', en: 'No data to export', th: 'ไม่มีข้อมูลให้ส่งออก', my: 'ပို့ရန်ဒေတာမရှိ' },
    'msg.print_failed': { zh: '打印失败: {0}', en: 'Print failed: {0}', th: 'พิมพ์ล้มเหลว: {0}', my: 'ပုံနှိပ်မရ: {0}' },
    'msg.max_batch_50': { zh: '最多批量操作 50 个', en: 'Maximum 50 items per batch', th: 'สูงสุด 50 รายการต่อครั้ง', my: 'တစ်ကြိမ်လျှင် ၅၀ အများဆုံး' },
    'msg.popup_blocked': { zh: '浏览器拦截了打印窗口。请在地址栏右侧点击"弹窗被拦截"图标，允许本网站弹窗后重试', en: 'Browser blocked popup. Allow popups for this site and retry', th: 'เบราว์เซอร์บล็อกป๊อปอัป กรุณาอนุญาตและลองใหม่', my: 'ဘရောက်ဇာက ပေါ့ပ်အပ်ပိတ်ထား ခွင့်ပြုပြီးပြန်ကြိုးစားပါ' },
    'msg.too_many_lines': { zh: '物料行数过多 ({0})，请减少选择的订单数量', en: 'Too many lines ({0}), reduce selected orders', th: 'รายการมากเกินไป ({0}) กรุณาลดจำนวนคำสั่ง', my: 'အတန်းများလွန်းသည် ({0}) အော်ဒါလျှော့ချပါ' },
    'msg.stock_consistent_skip': { zh: '库存一致，跳过', en: 'Stock consistent, skipped', th: 'สต็อกตรงกัน ข้าม', my: 'စတော့ကိုက်ညီ ကျော်လိုက်' },
    'msg.whs_cleared_not_in_master': { zh: '仓库代码 [{0}] 不在主数据中，已清空，请重新输入', en: 'Warehouse [{0}] not in master data, cleared', th: 'รหัสคลัง [{0}] ไม่อยู่ในข้อมูลหลัก ล้างแล้ว', my: 'ဂိုဒေါင်ကုဒ် [{0}] မာစတာတွင်မရှိ ရှင်းပြီး' },

    // 一键收货
    'msg.one_click_receipt_ok': { zh: '一键收货成功!', en: 'One-click receipt successful!', th: 'รับครั้งเดียวสำเร็จ!', my: 'တစ်ချက်နှိပ်လက်ခံအောင်မြင်!' },
    'msg.one_click_receipt_fail': { zh: '一键收货失败: {0}', en: 'One-click receipt failed: {0}', th: 'รับครั้งเดียวล้มเหลว: {0}', my: 'တစ်ချက်နှိပ်လက်ခံမရ: {0}' },
    'msg.one_click_remark': { zh: '一键收货', en: 'One-click receipt', th: 'รับครั้งเดียว', my: 'တစ်ချက်နှိပ်လက်ခံ' },
    'confirm.one_click_receipt': { zh: '一键收货: {0} x {1} ({2})?\n操作人: {3}', en: 'One-click receipt: {0} x {1} ({2})?\nOperator: {3}', th: 'รับครั้งเดียว: {0} x {1} ({2})?\nผู้ปฏิบัติ: {3}', my: 'တစ်ချက်နှိပ်: {0} x {1} ({2})?\nလုပ်ဆောင်သူ: {3}' },
    'confirm.add_bin_to_dict': { zh: '添加库位 [{0}] 到字典？', en: 'Add bin [{0}] to dictionary?', th: 'เพิ่มตำแหน่ง [{0}] ในพจนานุกรม?', my: 'တည်နေရာ [{0}] အဘိဓာန်သို့ထည့်?' },

    // LM 模块
    'result.lm_doc_created': { zh: '移库单创建成功: {0}', en: 'Move doc created: {0}', th: 'สร้างใบย้ายสำเร็จ: {0}', my: 'ရွှေ့စာဖန်တီးပြီး: {0}' },
    'result.lm_line_added': { zh: '已添加: {0} {1} → {2} × {3}', en: 'Added: {0} {1} → {2} × {3}', th: 'เพิ่มแล้ว: {0} {1} → {2} × {3}', my: 'ထည့်ပြီး: {0} {1} → {2} × {3}' },
    'confirm.lm_duplicate_pending': { zh: '待提交清单中已有 {0} {1} → {2} (数量: {3})\n是否继续追加一行?', en: 'Pending list already has {0} {1} → {2} (qty: {3})\nContinue adding?', th: 'รายการรอส่งมี {0} {1} → {2} (จำนวน: {3}) แล้ว\nเพิ่มต่อ?', my: 'စောင့်ဆိုင်းစာရင်းတွင် {0} {1} → {2} (အရေအတွက်: {3}) ရှိပြီး\nဆက်ထည့်?' },
    'confirm.lm_duplicate_tx': { zh: '已有提交记录: {0} {1} → {2} (数量: {3})\n是否继续追加?', en: 'Existing record: {0} {1} → {2} (qty: {3})\nContinue?', th: 'มีรายการแล้ว: {0} {1} → {2} (จำนวน: {3})\nเพิ่มต่อ?', my: 'မှတ်တမ်းရှိပြီး: {0} {1} → {2} (အရေအတွက်: {3})\nဆက်ထည့်?' },

    // IC 盘点模块
    'result.ic_doc_created': { zh: '盘点单创建成功: {0}', en: 'Count doc created: {0}', th: 'สร้างใบนับสำเร็จ: {0}', my: 'စစ်ဆေးစာဖန်တီးပြီး: {0}' },
    'result.ic_line_added': { zh: '已添加: {0} x {1}', en: 'Added: {0} x {1}', th: 'เพิ่มแล้ว: {0} x {1}', my: 'ထည့်ပြီး: {0} x {1}' },
    'msg.item_not_in_sap_ic': { zh: '物料 {0} 未在SAP中找到，不允许盘点', en: 'Item {0} not found in SAP, counting not allowed', th: 'สินค้า {0} ไม่พบใน SAP นับไม่ได้', my: 'ပစ္စည်း {0} SAP တွင်မတွေ့ စစ်ဆေးခွင့်မပြု' },

    // stock 模块
    'result.exported': { zh: '已导出 {0} 种物料, {1} 条明细', en: 'Exported {0} items, {1} details', th: 'ส่งออก {0} สินค้า, {1} รายละเอียด', my: '{0} ပစ္စည်း, {1} အသေးစိတ်ပို့ပြီး' },

    // export 模块
    'result.export_rows': { zh: '已导出 {0} 行数据', en: 'Exported {0} rows', th: 'ส่งออก {0} แถว', my: '{0} အတန်းပို့ပြီး' },
    'msg.export_failed': { zh: '导出失败: {0}', en: 'Export failed: {0}', th: 'ส่งออกล้มเหลว: {0}', my: 'ပို့မရ: {0}' },

    // shared.js
    'msg.doc_loading_wait': { zh: '单据加载中，请稍候...', en: 'Loading document, please wait...', th: 'กำลังโหลดเอกสาร กรุณารอ...', my: 'စာရွက်ဖွင့်နေသည် ခဏစောင့်ပါ...' },
    'msg.qty_abnormal_blocked': { zh: '数量异常 ({0})，疑似扫码枪误触，已拦截', en: 'Abnormal qty ({0}), possible scanner misfire, blocked', th: 'จำนวนผิดปกติ ({0}) อาจเกิดจากสแกนเนอร์ ถูกบล็อก', my: 'အရေအတွက်မမှန် ({0}) စကင်နာမှားနိုင် ပိတ်ပင်ပြီး' },
    'msg.old_barcode_format': { zh: '旧格式条码! 请使用新格式: {0} (无连字符)', en: 'Old barcode format! Use new format: {0} (no hyphen)', th: 'บาร์โค้ดรูปแบบเก่า! ใช้: {0} (ไม่มีขีด)', my: 'ဘားကုဒ်ပုံစံဟောင်း! {0} သုံးပါ (မျဥ်းတိုမပါ)' },
    'msg.numeric_barcode_hint': { zh: '纯数字条码，请使用前缀格式 (如 WO{0}, PO{0})', en: 'Numeric barcode, use prefix format (e.g. WO{0}, PO{0})', th: 'บาร์โค้ดตัวเลข ใช้รูปแบบนำหน้า (เช่น WO{0}, PO{0})', my: 'ဂဏန်းဘားကုဒ် WO{0}, PO{0} ပုံစံသုံးပါ' },
    'msg.barcode_unrecognized': { zh: '无法识别条码: {0}', en: 'Unrecognized barcode: {0}', th: 'ไม่รู้จักบาร์โค้ด: {0}', my: 'ဘားကုဒ်မသိ: {0}' },
    'msg.doc_mismatch_enter_again': { zh: '单据不匹配! 当前{0}, 条码是{1}。再次回车跳转', en: 'Doc mismatch! Current {0}, barcode is {1}. Press Enter again to jump', th: 'เอกสารไม่ตรง! ปัจจุบัน {0}, บาร์โค้ด {1} กด Enter อีกครั้งเพื่อไป', my: 'စာရွက်မကိုက်! လက်ရှိ {0}, ဘားကုဒ် {1}. Enter ထပ်နှိပ်၍သွား' },
    'msg.item_not_supported_here': { zh: '物料代码: {0}，当前页面不支持物料过滤', en: 'Item code: {0}, this page does not support item filtering', th: 'รหัสสินค้า: {0} หน้านี้ไม่รองรับการกรองสินค้า', my: 'ပစ္စည်းကုဒ်: {0} ဤစာမျက်နှာတွင်စစ်ထုတ်မရ' },
    'msg.doc_completed_no_scan': { zh: '当前单据已完成，无法继续扫码作业', en: 'Document completed, cannot continue scanning', th: 'เอกสารเสร็จแล้ว สแกนต่อไม่ได้', my: 'စာရွက်ပြီးပြီ ဆက်စကင်မရ' },
    'msg.item_not_in_doc': { zh: '当前单据不包含物料: {0}', en: 'Current document does not contain item: {0}', th: 'เอกสารไม่มีสินค้า: {0}', my: 'လက်ရှိစာရွက်တွင်ပစ္စည်း {0} မပါ' },
    'msg.item_all_done': { zh: '该物料已全部作业完毕', en: 'All operations for this item are done', th: 'สินค้านี้ดำเนินการเสร็จหมดแล้ว', my: 'ဤပစ္စည်းလုပ်ဆောင်မှုအားလုံးပြီးပြီ' },
    'msg.fill_field': { zh: '请填写: {0}', en: 'Please fill in: {0}', th: 'กรุณากรอก: {0}', my: 'ဖြည့်ပါ: {0}' },
    'msg.qty_over_remaining': { zh: '数量 {0} 超过剩余 {1}!', en: 'Qty {0} exceeds remaining {1}!', th: 'จำนวน {0} เกินเหลือ {1}!', my: 'အရေအတွက် {0} ကျန် {1} ထက်ကျော်!' },
    'msg.qty_over_must_remark': { zh: '数量超过剩余! 如需超收/超发, 请在备注中填写原因', en: 'Qty exceeds remaining! Add reason in remarks for over-receipt', th: 'จำนวนเกิน! กรุณากรอกเหตุผลในหมายเหตุ', my: 'အရေအတွက်ကျော်လွန်! မှတ်ချက်တွင်အကြောင်းပြချက်ဖြည့်ပါ' },
    'confirm.line_done_continue': { zh: '该行已完成 (剩余: {0})，是否继续录入？', en: 'Line completed (remaining: {0}), continue entry?', th: 'รายการเสร็จ (เหลือ: {0}) ป้อนต่อ?', my: 'အတန်းပြီးပြီ (ကျန်: {0}) ဆက်ထည့်?' },
    'confirm.qty_over_continue': { zh: '⚠ 数量 {0} 超过剩余 {1}!\n备注: {2}\n确认继续?', en: '⚠ Qty {0} exceeds remaining {1}!\nRemarks: {2}\nConfirm?', th: '⚠ จำนวน {0} เกินเหลือ {1}!\nหมายเหตุ: {2}\nยืนยัน?', my: '⚠ အရေအတွက် {0} ကျန် {1} ထက်ကျော်!\nမှတ်ချက်: {2}\nအတည်ပြု?' },
    'result.one_click_partial': { zh: '完成 {0}/{1}, 失败: {2}', en: 'Done {0}/{1}, failed: {2}', th: 'เสร็จ {0}/{1} ล้มเหลว: {2}', my: 'ပြီး {0}/{1} မအောင်မြင်: {2}' },
    'msg.master_data_load_fail': { zh: '⚠ 主数据加载失败，仓库/库位校验不可用，请联系管理员', en: '⚠ Master data load failed, warehouse/bin validation unavailable', th: '⚠ โหลดข้อมูลหลักล้มเหลว ตรวจสอบคลัง/ตำแหน่งไม่ได้', my: '⚠ မာစတာဒေတာဖွင့်မရ ဂိုဒေါင်/တည်နေရာစစ်ဆေးမရ' },
    'msg.bin_shortcut_removed': { zh: '已移除快捷库位 [{0}]', en: 'Removed bin shortcut [{0}]', th: 'ลบทางลัดตำแหน่ง [{0}] แล้ว', my: 'တည်နေရာဖြတ်လမ်း [{0}] ဖယ်ပြီး' },

    // OMS 模块
    'msg.max_batch_query_50': { zh: '最多批量查询 50 个单号', en: 'Max 50 doc numbers per batch query', th: 'สูงสุด 50 เลขที่ต่อครั้ง', my: 'တစ်ကြိမ်လျှင် ၅၀ အများဆုံး' },
    'msg.max_batch_print_50': { zh: '最多批量打印 50 个订单', en: 'Max 50 orders per batch print', th: 'สูงสุด 50 คำสั่งต่อครั้ง', my: 'တစ်ကြိမ်ပုံနှိပ် ၅၀ အများဆုံး' },
    'msg.dd_init_failed': { zh: 'DD看板初始化失败，请刷新页面重试', en: 'DD board init failed, refresh page', th: 'เริ่มต้นบอร์ด DD ล้มเหลว รีเฟรชหน้า', my: 'DD ဘုတ်စတင်မရ စာမျက်နှာပြန်ဖွင့်ပါ' },

    // ---- v0.3.4: 按钮/状态/Banner 国际化补全 ----

    // 行操作按钮
    'btn.pick': { zh: '拣货', en: 'Pick', th: 'หยิบ', my: 'ကောက်ယူ' },
    'btn.receipt': { zh: '收货', en: 'Receive', th: 'รับ', my: 'လက်ခံ' },
    'btn.issue': { zh: '发料', en: 'Issue', th: 'จ่าย', my: 'ထုတ်ပေး' },
    'btn.transfer': { zh: '调拨', en: 'Transfer', th: 'โอน', my: 'လွှဲပြောင်း' },
    'badge.completed': { zh: '已完成', en: 'Done', th: 'เสร็จ', my: 'ပြီးစီး' },

    // 一键操作按钮
    'so.one_click': { zh: '⚡ 一键拣货 (所有行剩余数量)', en: '⚡ Pick All Remaining', th: '⚡ หยิบทั้งหมดที่เหลือ', my: '⚡ ကျန်အားလုံးကောက်ယူ' },
    'pi.one_click': { zh: '⚡ 一键发料 (所有行剩余数量)', en: '⚡ Issue All Remaining', th: '⚡ จ่ายทั้งหมดที่เหลือ', my: '⚡ ကျန်အားလုံးထုတ်ပေး' },
    'tr.one_click': { zh: '⚡ 一键调拨 (所有行剩余数量)', en: '⚡ Transfer All Remaining', th: '⚡ โอนทั้งหมดที่เหลือ', my: '⚡ ကျန်အားလုံးလွှဲပြောင်း' },

    // SAP 状态
    'sap.status.O': { zh: '未清', en: 'Open', th: 'เปิด', my: 'ဖွင့်ထား' },
    'sap.status.C': { zh: '已关闭', en: 'Closed', th: 'ปิด', my: 'ပိတ်ပြီး' },
    'sap.status.R': { zh: '已下达', en: 'Released', th: 'ปล่อยแล้ว', my: 'ထုတ်ပေးပြီး' },
    'sap.status.P': { zh: '已计划', en: 'Planned', th: 'วางแผนแล้ว', my: 'စီစဉ်ပြီး' },
    'sap.status.L': { zh: '已关闭', en: 'Closed', th: 'ปิด', my: 'ပိတ်ပြီး' },

    // WMS 状态 (覆盖 STATUS_LABELS)
    'wms.status.pending': { zh: '待处理', en: 'Pending', th: 'รอดำเนินการ', my: 'စောင့်ဆိုင်း' },
    'wms.status.draft': { zh: '草稿', en: 'Draft', th: 'ร่าง', my: 'မူကြမ်း' },
    'wms.status.in_progress': { zh: '执行中', en: 'In Progress', th: 'กำลังดำเนินการ', my: 'ဆောင်ရွက်နေ' },
    'wms.status.split': { zh: '已拆分', en: 'Split', th: 'แยกแล้ว', my: 'ခွဲပြီး' },
    'wms.status.completed': { zh: '已完成', en: 'Completed', th: 'เสร็จสิ้น', my: 'ပြီးစီး' },
    'wms.status.cancelled': { zh: '已取消', en: 'Cancelled', th: 'ยกเลิก', my: 'ပယ်ဖျက်ပြီး' },
    'wms.status.exported': { zh: '已导出', en: 'Exported', th: 'ส่งออกแล้ว', my: 'ပို့ပြီး' },

    // Banner 消息
    'banner.all_picked': { zh: '该订单已全部完成拣货', en: 'All items picked for this order', th: 'หยิบสินค้าครบแล้ว', my: 'ဤမှာစာအားလုံးကောက်ယူပြီး' },
    'banner.all_received': { zh: '该订单已全部完成收货', en: 'All items received for this order', th: 'รับสินค้าครบแล้ว', my: 'ဤမှာစာအားလုံးလက်ခံပြီး' },
    'banner.all_issued': { zh: '该订单已全部完成发料', en: 'All items issued for this order', th: 'จ่ายวัตถุดิบครบแล้ว', my: 'ဤမှာစာအားလုံးထုတ်ပေးပြီး' },
    'banner.all_transferred': { zh: '该订单已全部完成调拨', en: 'All items transferred for this order', th: 'โอนสินค้าครบแล้ว', my: 'ဤမှာစာအားလုံးလွှဲပြောင်းပြီး' },
    'banner.split_to_dd': { zh: '该订单已拆分为DD，请使用DD单号进行拣货作业', en: 'Order split into DD, please use DD doc number for picking', th: 'คำสั่งแยกเป็น DD กรุณาใช้เลขที่ DD หยิบสินค้า', my: 'DD သို့ခွဲပြီး DD စာရွက်အမှတ်ဖြင့်ကောက်ယူပါ' },

    // 一键操作备注
    'remark.one_click_pick': { zh: '一键拣货', en: 'One-click pick', th: 'หยิบครั้งเดียว', my: 'တစ်ချက်နှိပ်ကောက်ယူ' },
    'remark.one_click_issue': { zh: '一键发料', en: 'One-click issue', th: 'จ่ายครั้งเดียว', my: 'တစ်ချက်နှိပ်ထုတ်ပေး' },
    'remark.one_click_transfer': { zh: '一键调拨', en: 'One-click transfer', th: 'โอนครั้งเดียว', my: 'တစ်ချက်နှိပ်လွှဲပြောင်း' },

    // 拣货录入卡片标题
    'so.pick_entry_title': { zh: '拣货录入 - ', en: 'Pick Entry - ', th: 'บันทึกหยิบ - ', my: 'ကောက်ယူထည့်သွင်း - ' },
};

// ============================================================================
// i18n 核心函数
// ============================================================================

var _currentLang = 'zh'; // 默认语言
var _supportedLangs = ['zh', 'en', 'th', 'my'];

// ============================================================================
// 纯翻译引擎 (Pure Engine — 零 DOM 依赖)
// ============================================================================

/**
 * 字典寻址 + 降级匹配 (纯函数)
 * 降级链: exact lang → base lang (zh-CN→zh) → en → key || ''
 * 空字符串翻译视为「未翻译」，自动跳过继续降级
 * @param {Object} dict - 翻译字典 { key: { lang: text } }
 * @param {string} lang - 目标语言代码 (如 'zh-CN', 'en', 'th')
 * @param {string} key  - 翻译键
 * @returns {string} 翻译文本，绝不抛 Error
 */
function resolveTranslation(dict, lang, key) {
    if (!dict || typeof dict !== 'object') return key || '';
    var entry = dict[key];
    if (!entry || typeof entry !== 'object') return key || '';

    // 1. 精确匹配
    if (entry[lang]) return entry[lang];

    // 2. 基础语言降级 (zh-CN → zh, en-US → en)
    if (typeof lang === 'string' && lang.indexOf('-') !== -1) {
        var base = lang.split('-')[0];
        if (entry[base]) return entry[base];
    }

    // 3. 英语兜底
    if (entry['en']) return entry['en'];

    // 4. 返回 key 本身
    return key || '';
}

/**
 * 字符串插值 (纯函数)
 * 将 {0}, {1}, {2}... 替换为 args 数组对应值 (全局替换)
 * @param {string} text - 含占位符的模板字符串
 * @param {Array}  args - 替换值数组
 * @returns {string} 插值后的字符串
 */
function interpolate(text, args) {
    if (typeof text !== 'string') return '';
    if (!Array.isArray(args) || args.length === 0) return text;

    var result = text;
    for (var i = 0; i < args.length; i++) {
        var val = args[i];
        // null/undefined → 空字符串; 0/false 等 Falsy 值正常转换
        var replacement = (val === null || val === undefined) ? '' : String(val);
        result = result.replace(new RegExp('\\{' + i + '\\}', 'g'), replacement);
    }
    return result;
}

// ============================================================================
// 对外 API (签名不变，内部委托纯引擎)
// ============================================================================

/**
 * 获取翻译文本
 * @param {string} key - 翻译键
 * @param {string} [fallback] - 找不到时的默认值
 * @returns {string}
 */
function t(key, fallback) {
    if (!I18N[key]) return fallback || key;
    return resolveTranslation(I18N, _currentLang, key) || fallback || key;
}

/**
 * 模板翻译: 支持 {0},{1},{2}... 占位符 (全局替换)
 * 用法: tpl('stock.summary', 5, 12, '100.00')
 * → "共 5 种物料, 12 条明细 | 合计实时库存: 100.00"
 */
function tpl(key) {
    var s = t(key);
    var args = [];
    for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
    return interpolate(s, args);
}

/**
 * 获取当前语言
 */
function getLang() {
    return _currentLang;
}

/**
 * 切换语言
 */
function setLang(lang) {
    if (_supportedLangs.indexOf(lang) === -1) lang = 'zh';
    _currentLang = lang;
    try { localStorage.setItem('wms_lang', lang); } catch (e) {}
    applyI18n();
    // 更新 HTML lang 属性
    var langMap = { zh: 'zh-CN', en: 'en', th: 'th', my: 'my' };
    document.documentElement.lang = langMap[lang] || lang;
}

/**
 * 应用翻译到页面所有 data-i18n 元素
 */
function applyI18n() {
    // 文本内容
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
        var key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
    });
    // innerHTML (用于带HTML的翻译)
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
        var key = el.getAttribute('data-i18n-html');
        if (key) el.innerHTML = t(key);
    });
    // placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
        var key = el.getAttribute('data-i18n-placeholder');
        if (key) el.placeholder = t(key);
    });
    // title属性
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
        var key = el.getAttribute('data-i18n-title');
        if (key) el.title = t(key);
    });
    // 更新语言切换器高亮
    document.querySelectorAll('.lang-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === _currentLang);
    });
    // 通知页面语言已更新 (多选下拉等组件需要刷新 summary)
    try { document.dispatchEvent(new Event('i18nUpdated')); } catch(e) {}
}

/**
 * 创建语言切换器（四语言版）
 *   A. 登录页：有 #login-lang-switcher 专用容器 → 渲染深色按钮到卡片内
 *   B. 内页：有 .header-nav → 在 logout 前插内联白色透明按钮，隐藏 fixed 版
 *   C. 其他页：fixed 右上角白色透明按钮保底
 */
function createLangSwitcher() {
    function makeClassButtons() {
        return '<button class="lang-btn" data-lang="zh" onclick="setLang(\'zh\')" title="中文">中</button>' +
               '<button class="lang-btn" data-lang="en" onclick="setLang(\'en\')" title="English">EN</button>' +
               '<button class="lang-btn" data-lang="th" onclick="setLang(\'th\')" title="ภาษาไทย">ไทย</button>' +
               '<button class="lang-btn" data-lang="my" onclick="setLang(\'my\')" title="မြန်မာ">မြန်</button>';
    }

    function makeLoginButtons() {
        var s = 'padding:4px 10px;border:1px solid #d1d5db;background:#f3f4f6;color:#374151;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;margin:0 2px;transition:background 0.15s;';
        return '<button class="lang-btn" style="' + s + '" data-lang="zh" onclick="setLang(\'zh\')" title="中文">中</button>' +
               '<button class="lang-btn" style="' + s + '" data-lang="en" onclick="setLang(\'en\')" title="English">EN</button>' +
               '<button class="lang-btn" style="' + s + '" data-lang="th" onclick="setLang(\'th\')" title="ภาษาไทย">ไทย</button>' +
               '<button class="lang-btn" style="' + s + '" data-lang="my" onclick="setLang(\'my\')" title="မြန်မာ">မြန်</button>';
    }

    // 始终先创建 fixed 版作为保底
    var fixed = document.createElement('div');
    fixed.className = 'lang-switcher no-print';
    fixed.id = 'langSwitcherFixed';
    fixed.style.cssText = 'position:fixed;top:6px;right:10px;z-index:10000;display:flex;gap:3px;';
    fixed.innerHTML = makeClassButtons();
    document.body.appendChild(fixed);

    // A. 登录页：专用容器（卡片内深色风格）
    var loginSlot = document.getElementById('login-lang-switcher');
    if (loginSlot) {
        loginSlot.innerHTML = makeLoginButtons();
        fixed.style.display = 'none';
        return fixed;
    }

    // B. 内页：header-nav 内联版，隐藏 fixed 版
    var headerNav = document.querySelector('.header-nav');
    if (headerNav) {
        var inline = document.createElement('div');
        inline.className = 'lang-switcher no-print';
        inline.style.cssText = 'display:flex;gap:3px;align-items:center;flex-shrink:0;';
        inline.innerHTML = makeClassButtons();
        var logoutBtn = headerNav.querySelector('.btn-logout');
        if (logoutBtn) {
            logoutBtn.parentNode.insertBefore(inline, logoutBtn);
        } else {
            headerNav.appendChild(inline);
        }
        fixed.remove();
    }

    // C. 其他页：fixed 版保持显示（默认）
    return fixed;
}

// ============================================================================
// 初始化
// ============================================================================

(function initI18n() {
    // 读取保存的语言偏好
    try {
        var saved = localStorage.getItem('wms_lang');
        if (saved && _supportedLangs.indexOf(saved) !== -1) {
            _currentLang = saved;
        }
    } catch (e) {}

    // DOM就绪后创建切换器并应用翻译
    function onReady() {
        createLangSwitcher();
        applyI18n();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }
})();

// ============================================================================
// Node.js 测试环境安全导出
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        I18N: I18N,
        resolveTranslation: resolveTranslation,
        interpolate: interpolate,
        t: t,
        tpl: tpl,
        getLang: getLang,
        setLang: setLang,
        applyI18n: applyI18n,
        createLangSwitcher: createLangSwitcher
    };
}
