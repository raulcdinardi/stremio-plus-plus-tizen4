#!/bin/bash
# tvkey.sh <port> <keyCode> [n] — dispatch remote keys inside the TV app via CDP
for i in $(seq 1 ${3:-1}); do node "$(dirname "$0")/tvcdp.js" $1 "(function(){['keydown','keyup'].forEach(function(t){var e=new KeyboardEvent(t,{bubbles:true,cancelable:true});Object.defineProperty(e,'keyCode',{value:$2});document.body.dispatchEvent(e);});return 1})()" >/dev/null; sleep 0.4; done
