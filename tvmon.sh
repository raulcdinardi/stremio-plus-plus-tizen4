#!/bin/bash
# tvmon.sh <port> <out.jsonl> — sample TV memory + player state every 5 s
while true; do
  r=$(timeout 12 node "$(dirname "$0")/tvcdp.js" $1 "JSON.stringify({t:Date.now(),avail:Math.round(tizen.systeminfo.getAvailableMemory()/1048576),nav:__spp.nav.name,st:(window.webapis&&webapis.avplay.getState()),pos:(function(){try{return Math.round(webapis.avplay.getCurrentTime()/1000)}catch(e){return null}})()})" 2>&1 | tail -1)
  echo "$(date +%T) $r" >> $2; sleep 5
done
