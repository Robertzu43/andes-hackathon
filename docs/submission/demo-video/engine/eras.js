window.FILM_SIZE = [1920,1080];
window.FILM_DURATION = 45;
window.BPM = 96;
window.PUNCH = 0;
window.SCENE_LIBS = ['scenes/tandem.js'];
window.TANDEM_ASSETS = ['assets/tandem-logo-ink.svg','assets/tandem-mark-ink.svg','assets/demo-truck.svg','assets/demo-station.svg'];
window.EXTRA_ASSETS = window.TANDEM_ASSETS;
window.ERAS = [
 ['tandem_01_road',4],['tandem_02_accept',6],['tandem_03_start',5],
 ['tandem_04_drive',5],['tandem_05_pause',6],['tandem_06_ok',6],
 ['tandem_07_sos',5],['tandem_08_read',5],['tandem_09_end',3]
].map(([id,dur],i)=>({id,dur,...(i?{transition:{type:'cut',dur:1/30,punch:0}}:{})}));
