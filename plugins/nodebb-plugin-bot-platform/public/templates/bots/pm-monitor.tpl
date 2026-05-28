<style>
.pm-page{max-width:960px;margin:0 auto;padding:24px 16px}
.pm-page h1{font-size:1.5rem;margin-bottom:6px}
.pm-subtitle{color:var(--bs-secondary-color,#888);margin-bottom:20px;font-size:.9rem}
.pm-layout{display:flex;gap:16px;min-height:500px}
.pm-sidebar{width:260px;flex-shrink:0;display:flex;flex-direction:column;gap:12px}
.pm-main{flex:1;display:flex;flex-direction:column}
.pm-card{background:var(--bs-body-bg,#fff);border:1px solid var(--bs-border-color,#dee2e6);border-radius:8px;padding:16px}
.pm-list{display:flex;flex-direction:column;gap:2px;max-height:600px;overflow-y:auto}
.pm-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;cursor:pointer;font-size:.88rem;transition:background .15s}
.pm-item:hover{background:var(--bs-tertiary-bg,#f0f0f0)}
.pm-item.active{background:#0d6efd;color:#fff}
.pm-item-name{font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pm-item-count{font-size:.75rem;background:var(--bs-tertiary-bg,#f0f0f0);padding:2px 7px;border-radius:10px}
.pm-item.active .pm-item-count{background:rgba(255,255,255,.25);color:#fff}
.pm-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.pm-header-title{font-weight:600;font-size:1rem}
.pm-empty{text-align:center;padding:48px 20px;color:var(--bs-secondary-color,#888);font-size:.9rem}
.pm-messages{display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;max-height:600px;padding:4px 0}
.pm-msg{display:flex;gap:10px;padding:8px 0}
.pm-msg-avatar{width:36px;height:36px;border-radius:50%;background:var(--bs-tertiary-bg,#e5e7eb);display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:600;color:var(--bs-secondary-color,#666);flex-shrink:0}
.pm-msg-body{flex:1;min-width:0}
.pm-msg-meta{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.pm-msg-name{font-weight:600;font-size:.82rem}
.pm-msg-time{font-size:.72rem;color:var(--bs-secondary-color,#999)}
.pm-msg-text{font-size:.88rem;line-height:1.5;word-break:break-word}
.pm-msg-system{font-size:.82rem;color:var(--bs-secondary-color,#888);font-style:italic;background:var(--bs-tertiary-bg,#f8f9fa);padding:8px 12px;border-radius:6px}
.pm-section-label{font-size:.78rem;color:var(--bs-secondary-color,#888);padding:6px 12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
</style>

<div class="pm-page">
<h1>Bot 私信记录</h1>
<p class="pm-subtitle" id="pm-subtitle"></p>

<div class="pm-layout">
<div class="pm-sidebar">
  <div class="pm-card" style="padding:12px">
    <div id="pm-sidebar-content"></div>
  </div>
</div>
<div class="pm-main">
  <div class="pm-card" style="flex:1;display:flex;flex-direction:column">
    <div class="pm-header" id="pm-header" style="display:none">
      <span class="pm-header-title" id="pm-header-title"></span>
    </div>
    <div class="pm-messages" id="pm-messages">
      <div class="pm-empty">选择左侧会话查看消息记录</div>
    </div>
  </div>
</div>
</div>
</div>


