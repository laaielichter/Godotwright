// Progressive enhancement: all content, commands and links work without JS.
const setups = {
  cli: {description: 'Review a project straight from npm. No clone needed.', command: 'npx -y godotwright review ~/games/my-game'},
  codex: {description: 'Connect the premium MCP toolkit to Codex.', command: 'codex mcp add godotwright -- npx -y godotwright mcp --tier premium'},
  claude: {description: 'Connect the premium MCP toolkit to Claude Code. The full install guide also covers the plugin.', command: 'claude mcp add godotwright -- npx -y godotwright mcp --tier premium'},
  mcp: {description: 'Add this server to your client’s MCP configuration. See the full install guide for the config file location.', command: JSON.stringify({mcpServers:{godotwright:{command:'npx',args:['-y','godotwright','mcp','--tier','premium']}}}, null, 2)}
};
const setupTabs = [...document.querySelectorAll('[data-setup]')];
function selectSetup(tab) {
  setupTabs.forEach(item => {const active = item === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;});
  document.getElementById('setup-description').textContent = setups[tab.dataset.setup].description;
  document.getElementById('setup-command').textContent = setups[tab.dataset.setup].command;
  document.getElementById('setup-panel').setAttribute('aria-labelledby', tab.id);
  document.querySelector('#setup-panel .copy').textContent = 'Copy';
}
setupTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectSetup(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if(event.key === 'ArrowRight') next = (index + 1) % setupTabs.length;
    if(event.key === 'ArrowLeft') next = (index - 1 + setupTabs.length) % setupTabs.length;
    if(event.key === 'Home') next = 0;
    if(event.key === 'End') next = setupTabs.length - 1;
    if(next !== undefined) {event.preventDefault(); selectSetup(setupTabs[next]); setupTabs[next].focus();}
  });
});
const copyStatus = document.createElement('span');
copyStatus.setAttribute('role','status');
copyStatus.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
document.body.append(copyStatus);
document.querySelectorAll('.cmd .copy').forEach(button => {
  let timer;
  button.addEventListener('click', async () => {
    const code = button.parentElement.querySelector('code');
    clearTimeout(timer);
    try {
      if(!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = 'Copied'; copyStatus.textContent = 'Command copied to clipboard.';
    } catch {
      const range = document.createRange(); range.selectNodeContents(code);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      button.textContent = 'Selected'; copyStatus.textContent = 'Command selected. Use your keyboard to copy.';
    }
    timer = setTimeout(() => {button.textContent = 'Copy'; copyStatus.textContent = '';}, 2200);
  });
});
const filters = [...document.querySelectorAll('[data-filter]')];
filters.forEach(button => button.addEventListener('click', () => {
  const filter = button.dataset.filter;
  filters.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  let count = 0;
  document.querySelectorAll('.model-card').forEach(card => {card.hidden = filter !== 'all' && card.dataset.category !== filter; if(!card.hidden) count++;});
  document.getElementById('gallery-count').textContent = `${count} model previews`;
}));
