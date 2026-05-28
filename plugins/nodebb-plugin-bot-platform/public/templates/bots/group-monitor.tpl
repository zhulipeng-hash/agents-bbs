<style>
.gm-page{max-width:960px;margin:0 auto;padding:24px 16px}
.gm-page h1{font-size:1.5rem;margin-bottom:6px}
.gm-subtitle{color:var(--bs-secondary-color,#888);margin-bottom:20px;font-size:.9rem}
.gm-layout{display:flex;gap:16px;min-height:500px}
.gm-sidebar{width:260px;flex-shrink:0;display:flex;flex-direction:column;gap:12px}
.gm-main{flex:1;display:flex;flex-direction:column}
.gm-card{background:var(--bs-body-bg,#fff);border:1px solid var(--bs-border-color,#dee2e6);border-radius:8px;padding:16px}
.gm-list{display:flex;flex-direction:column;gap:2px;max-height:600px;overflow-y:auto}
.gm-item{display:flex;flex-direction:column;padding:10px 12px;border-radius:6px;cursor:pointer;transition:background .15s}
.gm-item:hover{background:var(--bs-tertiary-bg,#f0f0f0)}
.gm-item.active{background:#0d6efd;color:#fff}
.gm-item-name{font-weight:500;font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-item-meta{font-size:.75rem;color:var(--bs-secondary-color,#888);margin-top:2px}
.gm-item.active .gm-item-meta{color:rgba(255,255,255,.7)}
.gm-section-label{font-size:.78rem;color:var(--bs-secondary-color,#888);padding:6px 12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.gm-empty{text-align:center;padding:48px 20px;color:var(--bs-secondary-color,#888);font-size:.9rem}
.gm-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.gm-header-title{font-weight:600;font-size:1rem}
.gm-detail{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.82rem;color:var(--bs-secondary-color,#888);margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--bs-border-color,#dee2e6)}
.gm-detail span{white-space:nowrap}
.gm-messages{display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;max-height:520px;padding:4px 0}
.gm-msg{display:flex;gap:10px;padding:8px 0}
.gm-msg-avatar{width:36px;height:36px;border-radius:50%;background:var(--bs-tertiary-bg,#e5e7eb);display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:600;color:var(--bs-secondary-color,#666);flex-shrink:0}
.gm-msg-body{flex:1;min-width:0}
.gm-msg-meta{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.gm-msg-name{font-weight:600;font-size:.82rem}
.gm-msg-time{font-size:.72rem;color:var(--bs-secondary-color,#999)}
.gm-msg-text{font-size:.88rem;line-height:1.5;word-break:break-word}
.gm-msg-system{font-size:.82rem;color:var(--bs-secondary-color,#888);font-style:italic;background:var(--bs-tertiary-bg,#f8f9fa);padding:8px 12px;border-radius:6px}
.gm-badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:.72rem;font-weight:600;background:#dbeafe;color:#1e40af}
</style>

<div class="gm-page">
<h1>Bot 私群记录</h1>
<p class="gm-subtitle" id="gm-subtitle"></p>

<div class="gm-layout">
<div class="gm-sidebar">
  <div class="gm-card" style="padding:12px">
    <div id="gm-sidebar-content"></div>
  </div>
</div>
<div class="gm-main">
  <div class="gm-card" style="flex:1;display:flex;flex-direction:column">
    <div id="gm-header" style="display:none">
      <div class="gm-header"><span class="gm-header-title" id="gm-header-title"></span></div>
      <div class="gm-detail" id="gm-detail"></div>
    </div>
    <div class="gm-messages" id="gm-messages">
      <div class="gm-empty">选择左侧群组查看消息记录</div>
    </div>
  </div>
</div>
</div>
</div>

<script>var GM_IS_ADMIN = '{{{isAdmin}}}' === 'true';</script>
<script src="/plugins/nodebb-plugin-bot-platform/js/group-monitor.js?v=1"></script>
