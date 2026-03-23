// 为所有工作流 JSON 添加唯一 ID (n8n import:workflow 要求)
// 用法: docker cp add-ids.js dp-wf:/tmp/ && docker exec dp-wf node /tmp/add-ids.js /tmp/wf-import
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===== 可测试纯函数 =====

/** 生成 10 位十六进制随机 ID */
function generateWorkflowId() {
  return crypto.randomBytes(5).toString('hex').substring(0, 10);
}

/** 判断工作流 JSON 是否需要添加 ID */
function shouldAddId(data) {
  return !data.id;
}

/** 筛选目录中的工作流 JSON 文件名 */
function filterWorkflowFiles(filenames) {
  return filenames.filter(f => f.endsWith('.json') && f.startsWith('wf'));
}

/** 处理单个工作流文件数据，返回 { data, added, id } */
function processWorkflowData(data) {
  if (shouldAddId(data)) {
    data.id = generateWorkflowId();
    return { data: data, added: true, id: data.id };
  }
  return { data: data, added: false, id: data.id };
}

// ===== CLI 主流程 =====

/* istanbul ignore next */
if (require.main === module) {
  var dir = process.argv[2] || '/tmp/wf-import';
  var files = filterWorkflowFiles(fs.readdirSync(dir));

  console.log(`找到 ${files.length} 个工作流文件`);
  files.forEach(function(f) {
    var fp = path.join(dir, f);
    var data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    var result = processWorkflowData(data);
    if (result.added) {
      fs.writeFileSync(fp, JSON.stringify(result.data, null, 2));
      console.log(`  ✅ 添加 id=${result.id} → ${f}`);
    } else {
      console.log(`  ℹ️ 已有 id=${result.id} → ${f}`);
    }
  });
  console.log('完成!');
}

module.exports = { generateWorkflowId, shouldAddId, filterWorkflowFiles, processWorkflowData };
