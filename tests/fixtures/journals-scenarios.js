// Figures the journal-aware compliance report must leave exactly as they were when no
// target journal is set. Each body runs in the page after seedPanels(page, 4) and returns
// the report's title, its header line and every row's text. The expected values were
// read from the app before the journal table existed (compliance-baseline-nojournal.json).
const READ = `const read=()=>{
  const m=document.getElementById('info-modal-bg');
  const rows=m?[...m.querySelectorAll('.compliance-row')].map(e=>e.textContent.replace(/\\s+/g,' ').trim()):[];
  const title=m?document.getElementById('im-title').textContent:'';
  const hd=m?m.querySelector('#im-body > div'):null;
  const head=hd?hd.textContent.replace(/\\s+/g,' ').trim():'';
  if(m) m.remove();
  return {title, head, rows};
};`;
module.exports = {
  plain: READ + ` checkCompliance(); return read();`,
  furnished: READ + `
    images[0].lut='magenta'; images[1].lut='green'; images[0].umPerPx=0.2; images[0].sbOn=true;
    images[2].gamma=3; sv('fig-title','Seeded'); sc('show-col-labels',true); onLayoutChange();
    sv('bg-color','#eeeeee'); sv('export-dpi','150'); sv('export-width-mm','89'); render();
    checkCompliance(); return read();`,
};
