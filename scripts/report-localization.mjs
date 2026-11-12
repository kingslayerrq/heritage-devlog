// Discord presentation only: keep source documents, metadata and GitHub diagnostics
// unchanged. Exact messages distinguish diagnostics that share a source error code.
const messages = new Map([
  ['The Notion submission is incomplete.', 'Notion 提交内容不完整。'],
  ['The article path is invalid.', '文章文件路径无效。'],
  ['The submission contains unsupported article fields.', '提交内容包含不支持的文章字段。'],
  ['Title, date, or discipline is invalid.', '文章标题、日期或领域无效。'],
  ['The stable entry ID or registered author IDs are invalid.', '文章固定标识或已登记的作者标识无效。'],
  ['Summary must be nonempty text when supplied.', '填写 Summary 时必须提供非空文本。'],
  ['Tags must be short text labels.', 'Tags 必须是简短的文本标签。'],
  ['A text field contains unsupported control characters.', '文本字段包含不支持的控制字符。'],
  ['The article text exceeds 256 KiB.', '文章文本超过 256 KiB。'],
  ['The converted article exceeds 256 KiB.', '转换后的文章超过 256 KiB。'],
  ['A temporary file URL cannot be published as a text link.', '临时文件地址不能作为正文链接发布。'],
  ['A link uses an unsupported or unsafe URL.', '链接使用了不支持或不安全的地址。'],
  ['The rich text is incomplete or too large.', '富文本内容不完整或过大。'],
  ['A rich-text item is invalid.', '富文本项无效。'],
  ['Inline math contains unsupported delimiters.', '行内公式包含不支持的分隔符。'],
  ['Inline equations in tables are not supported yet.', '暂不支持表格中的行内公式。'],
  ['This Notion mention or rich-text type is not supported.', '不支持此 Notion 提及或富文本类型。'],
  ['The text annotations are invalid.', '文本格式标记无效。'],
  ['Notion block colors use the website theme instead.', 'Notion 内容块颜色将统一使用网站主题颜色。'],
  ['Notion text colors use the website theme instead.', 'Notion 文本颜色将统一使用网站主题颜色。'],
  ['Code or media captions contain formatting that cannot be preserved here.', '代码或媒体说明包含无法保留的格式。'],
  ['Some child blocks were not retrieved.', '部分子内容块未能读取。'],
  ['Child blocks are malformed.', '子内容块格式无效。'],
  ['This file is not hosted on an approved HTTPS source.', '此文件不在允许的 HTTPS 来源上。'],
  ['The file name is invalid.', '文件名无效。'],
  ['The file type does not match this Notion block.', '文件类型与此 Notion 内容块不匹配。'],
  ['A submission may download at most 20 files.', '一次提交最多可下载 20 个文件。'],
  ['The file could not be downloaded safely.', '无法安全下载此文件。'],
  ['The download did not contain file bytes.', '下载结果不包含文件数据。'],
  ['Files are limited to 25 MiB each and 100 MiB per submission.', '单个文件不得超过 25 MiB，一次提交的文件总量不得超过 100 MiB。'],
  ['The file type is unsupported or does not match this Notion block.', '文件类型不受支持，或与此 Notion 内容块不匹配。'],
  ['The page exceeds 500 blocks or 12 nesting levels.', '页面超过 500 个内容块或 12 层嵌套。'],
  ['A Notion block is incomplete.', 'Notion 内容块不完整。'],
  ['The submitted page includes an archived block.', '提交的页面包含已归档内容块。'],
  ['A toggle heading is expanded on the website.', '折叠标题将在网站上展开显示。'],
  ['A checkbox value is invalid.', '复选框的值无效。'],
  ['Code blocks cannot contain child blocks.', '代码块不能包含子内容块。'],
  ['The code language is unsupported.', '代码语言不受支持。'],
  ['A divider unexpectedly contains children.', '分隔线包含不应存在的子内容块。'],
  ['The callout icon is omitted; its text is retained.', '提示块图标将被省略，文字会保留。'],
  ['Notion columns are shown sequentially on the website.', 'Notion 分栏将在网站上按顺序显示。'],
  ['A column layout contains an unexpected child.', '分栏布局包含不支持的子内容块。'],
  ['The table is empty or too wide.', '表格为空或列数过多。'],
  ['A table row is incomplete or has the wrong number of cells.', '表格行不完整，或单元格数量与列数不符。'],
  ['The equation is empty or has unsupported delimiters.', '公式为空或包含不支持的分隔符。'],
  ['A bookmark unexpectedly contains children.', '书签包含不应存在的子内容块。'],
  ['A media block unexpectedly contains children.', '媒体块包含不应存在的子内容块。'],
  ['The video URL is invalid.', '视频地址无效。'],
  ['The YouTube video ID is invalid.', 'YouTube 视频标识无效。'],
  ['An image has no description.', '图片缺少说明文字。'],
  ['This Notion block type cannot be published yet.', '暂不支持发布此类 Notion 内容块。'],
  ['The article body is empty.', '文章正文为空。请在页面属性下方添加正文。'],
  ['The Notion import could not be completed. No source files were overwritten.', 'Notion 导入未能完成，原有文件未被覆盖。'],
  ['This imported file has changed in Git. Reconcile it with the Notion source before importing again.', '此导入文件已在 Git 中修改。请先核对并合并 Git 与 Notion 的内容，再重新导入。'],
  ['The destination article already exists and is not owned by this Notion page.', '目标文章已存在，且不属于此 Notion 页面。'],
  ['Main advanced before this import could be reviewed. Set the page to Ready again.', '导入审核前 main 已更新。请重新将页面设为待发布状态。'],
  ['The page is unavailable or outside the configured devlog database.', '页面不可访问，或不在配置的开发日志数据库中。'],
  ['Add a title of at most 1,000 characters in the Name property.', '请在 Name 属性中填写不超过 1,000 个字符的标题。'],
  ['Choose Tech, Art, Design, Audio, Narrative, or Production in Discipline.', '请在 Discipline 中选择技术、美术、设计、音频、叙事或制作管理（tech、art、design、audio、narrative、production）。'],
  ['Set a valid Date for this entry.', '请为此条目设置有效的 Date 日期。'],
  ['Authors must be a complete Notion People property.', 'Authors 必须是完整的 Notion 人员属性。'],
  ['Every credited person must register in Discord and link their Notion account.', '每位署名作者都必须先在 Discord 注册并绑定 Notion 账号。'],
  ['The submitting author is not eligible to publish.', '提交者目前没有发布资格。'],
  ['Summary must be a text property.', 'Summary 必须是文本属性。'],
  ['Shorten Summary to at most 3,000 characters.', '请将 Summary 缩短至最多 3,000 个字符。'],
  ['Tags must be a multi-select property.', 'Tags 必须是多选属性。'],
  ['Use at most 30 short text tags.', '请使用最多 30 个简短文本标签。'],
  ['The page changed while it was being captured. Finish editing, then submit again.', '读取期间页面发生了变化。请完成编辑后重新提交。'],
  ['The Notion entry is too large.', 'Notion 条目内容过大。'],
  ['The person who submits this page must first register in Discord and link their Notion account.', '页面提交者必须先在 Discord 注册并绑定 Notion 账号。'],
  ['The submitting account was unlinked or lost publishing access.', '提交账号已解除绑定或失去发布资格。'],
  ['The submitted page has changed. Set Ready to update again to review the new version.', '已提交的页面发生了变化。请重新选择 Ready to update，审核新版本。'],
  ['The page changed after submission. Finish editing and submit again.', '提交后页面发生了变化。请完成编辑后重新提交。'],
  ['The publication request changed or was withdrawn. Submit the new version again.', '发布请求已改变或撤回。请重新提交新版本。'],
  ['This page has publication records in a different Notion source. Ask the owner to reconcile its original source before importing it here.', '此页面在其他 Notion 数据源中有发布记录。请先由所有者核对原数据源，再导入此处。'],
  ['This submission belongs to a different Notion source. Reconnect or reconcile its original database.', '此提交属于其他 Notion 数据源。请重新连接或核对原数据库。'],
  ['A submitting or credited author is no longer eligible.', '提交者或署名作者已失去发布资格。'],
  ['Notion page capacity reached; contact the owner.', 'Notion 页面记录已达到容量上限，请联系所有者。'],
  ['Notion submission capacity reached; contact the owner.', 'Notion 提交记录已达到容量上限，请联系所有者。'],
  ['Remove Notion mentions from Name and Summary before publishing.', '发布前请移除 Name 和 Summary 中的 Notion 提及。'],
  ['This Notion page takes too many requests or too long to read. Reduce nested sections and try again.', '读取此 Notion 页面所需请求过多或耗时过长。请减少嵌套内容后重试。'],
  ['Notion content exceeds the supported nesting depth.', 'Notion 内容超过支持的嵌套深度。'],
  ['A Notion page property is incomplete or exceeds the supported author limit.', 'Notion 页面属性不完整，或作者数量超过支持的上限。'],
  ['Notion rejected the request.', 'Notion 拒绝了请求，请检查连接权限与页面访问权限。'],
  ['Notion returned an invalid or incomplete response.', 'Notion 返回了无效或不完整的响应。'],
  ['The pull request or main branch changed after review; refresh the branch and rerun validation.', '审核后合并请求或 main 已改变。请更新分支并重新运行验证。'],
  ['Main must require pull requests and the strict App-scoped Devlog content check before automatic merging.', '自动合并前，main 必须启用合并请求保护，并要求发布应用提供严格的 Devlog content 检查。'],
  ['Invalid registered author ID.', '登记的作者标识无效。'],
  ['A registered author needs a verified Discord ID.', '登记作者缺少已验证的 Discord 标识。'],
  ['A registered author needs a platform display name.', '登记作者缺少平台显示名称。'],
  ['A GitHub connection needs both a verified ID and a valid current login.', 'GitHub 绑定必须同时提供已验证的标识和有效的当前用户名。'],
  ['The author registry must contain at most 1000 members.', '作者登记表最多可包含 1,000 名成员。'],
  ['The author registry contains duplicate platform identities.', '作者登记表包含重复的平台身份。'],
  ['Invalid platform avatar URL.', '平台头像地址无效。'],
  ['Avatar must use the platform HTTPS CDN.', '头像必须使用平台的 HTTPS 内容分发地址。'],
]);
const fixes = new Map([
  ['Correct this Notion block and request publication again.', '请修正此 Notion 内容块，再重新提交发布。'],
  ['Correct the Notion page, then choose Ready to publish or Ready to update again.', '请修正 Notion 页面，再选择 Ready to publish 或 Ready to update。'],
  ['Review the Notion page feedback and GitHub run. Correct the source, then set its status to Ready again.', '请查看 Notion 反馈和 GitHub 检查记录，修正内容后重新选择待发布状态。'],
  ['Use a Notion image or file block so the file can be copied into the repository.', '请使用 Notion 图片块或文件块，以便将文件复制到仓库。'],
  ['Use a complete HTTPS link.', '请使用完整的 HTTPS 链接。'],
  ['Move the equation into a separate block.', '请将公式移到独立内容块中。'],
  ['Replace the mention with explicit public text or an HTTPS link.', '请将提及替换为明确的公开文本或 HTTPS 链接。'],
  ['Use emphasis if the color carries meaning.', '如果颜色用于表达含义，请改用加粗等强调格式。'],
  ['Use plain text for this code block or caption.', '请在此代码块或说明中使用纯文本。'],
  ['Refresh the submission after the page has finished saving.', '请等待页面保存完成，再重新提交。'],
  ['Upload the file directly to Notion instead of linking an external host.', '请直接将文件上传到 Notion。'],
  ['Refresh the Notion file, check its size, and request publication again.', '请刷新 Notion 文件并检查大小，再重新提交发布。'],
  ['Use a supported image, MP4/WebM video, self-contained GLB, PDF, ZIP, or TXT file.', '请使用支持的图片、MP4/WebM 视频、包含全部资源的 GLB、PDF、ZIP 或 TXT 文件。'],
  ['Refresh the page snapshot before retrying.', '请刷新页面后重新提交。'],
  ['Choose a supported code language or Plain Text.', '请选择支持的代码语言或纯文本选项。'],
  ['Check that the reading order still makes sense.', '请检查内容的阅读顺序是否正确。'],
  ['Add an English image caption in Notion.', '请在 Notion 中为图片添加英文说明。'],
  ['Replace it with supported text, lists, tables, images, files, or video.', '请替换为支持的文本、列表、表格、图片、文件或视频。'],
  ['Split the article into smaller entries.', '请将文章拆分为较短的条目。'],
]);
const stages = { setup: '初始化', prepare: '准备检查', build: '构建网站', finalize: '完成审核与合并', reconcile: '恢复发布状态', import: '导入 Notion', 'notion-import': '导入 Notion', deploy: '部署网站', report: '发送发布报告' };
const yamlReasons = new Map([
  ['duplicated mapping key', '字段名称重复'], ['bad indentation of a mapping entry', '字段缩进不正确'],
  ['can not read a block mapping entry; a multiline key may not be an implicit key', '无法读取字段；多行字段名需要显式声明'],
  ['unexpected end of the stream within a double quoted scalar', '双引号未闭合'],
  ['unexpected end of the stream within a single quoted scalar', '单引号未闭合'],
  ['unexpected end of the stream within a flow collection', '列表或对象未闭合'],
  ['missed comma between flow collection entries', '列表或对象项目之间缺少逗号'],
  ['end of the stream or a document separator is expected', '此处需要文档结束或文档分隔符'],
  ['unacceptable kind of an object to dump [object Undefined]', '字段值未定义'],
]);
const fallbackMessages = {
  'notion.source': 'Notion 来源验证未通过。请检查页面属性、提交者绑定、发布资格及页面是否仍位于指定数据库。',
  'merge-precondition': '暂时无法确认合并条件。请检查分支版本、合并请求状态和 main 保护设置。',
  'identity.registry': '作者登记资料无效。请由管理员检查 Discord 身份同步和平台绑定。',
  'identity.avatar': '作者头像同步失败。请检查平台头像地址与访问权限。',
};
function translated(value, catalog, { code, fix = false } = {}) {
  if (!value) return '';
  const source = String(value);
  const match = /^(.*?) Source: (https:\/\/(?:www\.)?notion\.so\/[a-f0-9-]+(?:#[a-f0-9-]+)?)$/s.exec(source);
  const original = match ? match[1] : source;
  let result = catalog.get(original);
  if (!result && original.startsWith('自动发布流程未能完成此阶段：')) {
    const stage = original.slice('自动发布流程未能完成此阶段：'.length);
    result = '自动发布流程未能完成此阶段：' + (stages[stage] || '工作流执行');
  }
  if (!result && code === 'metadata.yaml' && !fix) {
    const reason = original.replace(/^YAML 格式错误：/, '');
    const quoted = [...reason.matchAll(/"([^"\r\n]{1,100})"/g)].map(item => item[0]);
    result = 'YAML 格式错误：' + (yamlReasons.get(reason) || '请检查字段缩进、引号、冒号和列表格式') + (quoted.length ? '。相关内容：' + quoted.join('、') : '');
  }
  if (!result && /\p{Script=Han}/u.test(original)) result = original;
  if (!result && !fix) {
    const http = /^(GitHub|Devlog integration) request failed \((\d{3})\)\.$/.exec(original);
    if (http) result = (http[1] === 'GitHub' ? 'GitHub ' : '开发日志服务') + '请求失败（HTTP ' + http[2] + '）。';
  }
  if (!result) result = fix ? '请打开检查记录，修正对应问题后重新提交；配置问题请联系仓库所有者。' :
    fallbackMessages[code] || '检查未通过，请打开检查记录查看详情' + (/^[a-z0-9.-]{1,80}$/i.test(code || '') ? '（诊断代码：' + code + '）' : '') + '。';
  return result + (match ? ' 来源：' + match[2] : '');
}
export function localizeReportIssue(issue) {
  return { ...issue, message: translated(issue.message, messages, { code: issue.code }),
    ...(issue.fix ? { fix: translated(issue.fix, fixes, { code: issue.code, fix: true }) } : {}) };
}
