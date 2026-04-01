function r(t){return!t&&t!==0?"—":t<1024?t+" B":t<1048576?(t/1024).toFixed(1)+" KB":t<1073741824?(t/1048576).toFixed(1)+" MB":(t/1073741824).toFixed(2)+" GB"}export{r as f};
