# Protocole bridge ⇄ app (WebSocket JSON)

La connexion est **toujours ouverte par le téléphone** vers `ws://<IP Tailscale du Mac>:8765`.

```
tél → bridge  {type:"hello", token, device:{model,android,app}, methods:[...], shizuku:bool}
bridge → tél  {type:"welcome"}                      (ou fermeture 4401 si jeton invalide)
bridge → tél  {type:"req", id, method, params}
tél → bridge  {type:"res", id, ok:true, result} | {type:"res", id, ok:false, error:{code,message}}
tél → bridge  {type:"event", name, data}
```

Événements : `stop`, `resume` (uniquement bouton de l'app), `shizuku {active}`, `methods [...]` (ré-annonce quand une permission change),
`notification {app,title,text,key}`, `missed_call {number,name}`, `sms {from,name,body}`.

Méthodes : voir `android/.../Router.kt` (natif) et `bridge/src/phone/shellimpl.ts` (shell ADB/Shizuku).
L'app n'annonce que les méthodes **réellement utilisables** (ex. `ui.*` seulement si l'accessibilité est active) :
le bridge se replie alors automatiquement sur le shell.
