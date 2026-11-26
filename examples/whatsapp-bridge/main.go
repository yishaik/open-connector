package main

import (
 "context"
 "crypto/rand"
 "crypto/subtle"
 "database/sql"
 "encoding/base64"
 "encoding/hex"
 "encoding/json"
 "html/template"
 "log"
 "net/http"
 "os"
 "os/signal"
 "strings"
 "sort"
 "sync"
 "syscall"
 "time"

 _ "github.com/mattn/go-sqlite3"
 qrcode "github.com/skip2/go-qrcode"
 "go.mau.fi/whatsmeow"
 "go.mau.fi/whatsmeow/proto/waE2E"
 "go.mau.fi/whatsmeow/store/sqlstore"
 "go.mau.fi/whatsmeow/types"
 "go.mau.fi/whatsmeow/types/events"
 "google.golang.org/protobuf/proto"
)

const maxMedia = 4 * 1024 * 1024
type Bridge struct {
 db *sql.DB
 client *whatsmeow.Client
 runtime, admin, csrf string
 allow map[string]bool
 sendEnabled bool
 mu sync.RWMutex
 qr string
 qrExpires time.Time
}
type Input struct {
 ChatID string `json:"chatId"`
 MessageID string `json:"messageId"`
 Query string `json:"query"`
 After string `json:"after"`
 Before string `json:"before"`
 Limit int `json:"limit"`
 Cursor string `json:"cursor"`
 Text string `json:"text"`
 RequestID string `json:"requestId"`
}
type Message struct {
 ID string `json:"id"`
 ChatID string `json:"chatId"`
 Sender string `json:"sender"`
 Text string `json:"text"`
 Timestamp string `json:"timestamp"`
 FromMe bool `json:"fromMe"`
 Media bool `json:"hasMedia"`
}
func require(e error) { if e != nil { log.Fatal("startup failed") } }
func randomToken() string { b:=make([]byte,32); if _,e:=rand.Read(b);e!=nil{panic("random failure")};return hex.EncodeToString(b) }
func same(a,b string) bool { return a!="" && subtle.ConstantTimeCompare([]byte(a),[]byte(b))==1 }
func reply(w http.ResponseWriter, code int, data any) { w.Header().Set("Content-Type","application/json"); w.WriteHeader(code); _=json.NewEncoder(w).Encode(data) }
func fail(w http.ResponseWriter, code int, message string){reply(w,code,map[string]string{"error":message})}
func headers(w http.ResponseWriter) {
 w.Header().Set("Cache-Control","no-store")
 w.Header().Set("X-Content-Type-Options","nosniff")
 w.Header().Set("Referrer-Policy","no-referrer")
 w.Header().Set("Content-Security-Policy","default-src 'none'; img-src 'self'; form-action 'self'; frame-ancestors 'none'")
}
func (b *Bridge) permitted(chat string) bool { return b.allow[chat] }
func (b *Bridge) store(m *events.Message) {
 if !b.permitted(m.Info.Chat.String()) || m.Message==nil {return}
 // Do not archive ephemeral or view-once messages.
 if m.IsEphemeral || m.IsViewOnce {return}
 msg:=m.Message
 text:=msg.GetConversation()
 if text=="" {text=msg.GetExtendedTextMessage().GetText()}
 if text=="" {text=msg.GetImageMessage().GetCaption()}
 if text=="" {text=msg.GetDocumentMessage().GetCaption()}
 media:=msg.GetImageMessage()!=nil||msg.GetDocumentMessage()!=nil||msg.GetAudioMessage()!=nil
 if text==""&&!media{return}
 var raw []byte
 if media {raw,_=proto.Marshal(msg)}
 _,e:=b.db.Exec("INSERT OR IGNORE INTO messages(id,chat,sender,body,ts,from_me,media) VALUES(?,?,?,?,?,?,?)",m.Info.ID,m.Info.Chat.String(),m.Info.Sender.String(),text,m.Info.Timestamp.UTC().Format(time.RFC3339),m.Info.IsFromMe,raw)
 if e!=nil{log.Print("message persistence failed")}
}
func (b *Bridge) event(evt any) {
 switch m:=evt.(type) {
 case *events.Message: b.store(m)
 case *events.HistorySync:
  // History is best-effort; parse only WhatsApp-provided sync data.
  for _,c:=range m.Data.GetConversations() {
   jid,e:=types.ParseJID(c.GetID());if e!=nil||!b.permitted(jid.String()){continue}
   for _,item:=range c.GetMessages() {
    parsed,e:=b.client.ParseWebMessage(jid,item.GetMessage());if e==nil&&parsed!=nil{b.store(parsed)}
   }
  }
 }
}
func main(){
 syscall.Umask(0077)
 runtime,admin:=os.Getenv("WA_RUNTIME_TOKEN"),os.Getenv("WA_ADMIN_TOKEN")
 if len(runtime)<32||len(admin)<32||same(runtime,admin){log.Fatal("set distinct strong runtime and admin tokens")}
 allow:=map[string]bool{}
 for _,id:=range strings.Split(os.Getenv("WA_ALLOWED_CHATS"),","){id=strings.TrimSpace(id);if id!=""{allow[id]=true}}
 dir:=os.Getenv("WA_DATA_DIR");if dir==""{dir="./data"}
 require(os.MkdirAll(dir,0700))
 require(os.Chmod(dir,0700))
 db,e:=sql.Open("sqlite3","file:"+dir+"/messages.sqlite?_busy_timeout=5000&_journal_mode=WAL");require(e);defer db.Close();db.SetMaxOpenConns(1)
 _,e=db.Exec(`CREATE TABLE IF NOT EXISTS messages(id TEXT NOT NULL,chat TEXT NOT NULL,sender TEXT NOT NULL,body TEXT NOT NULL,ts TEXT NOT NULL,from_me INTEGER NOT NULL,media BLOB,PRIMARY KEY(chat,id));
 CREATE INDEX IF NOT EXISTS msg_time ON messages(chat,ts,id);
 CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,chat TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,state TEXT NOT NULL);`);require(e)
 ctx,cancel:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM);defer cancel()
 container,e:=sqlstore.New(ctx,"sqlite3","file:"+dir+"/session.sqlite?_foreign_keys=on",nil);require(e);defer container.Close()
 device,e:=container.GetFirstDevice(ctx);require(e)
 client:=whatsmeow.NewClient(device,nil);defer client.Disconnect()
 b:=&Bridge{db:db,client:client,runtime:runtime,admin:admin,csrf:randomToken(),allow:allow,sendEnabled:os.Getenv("WA_ENABLE_SEND")=="true"}
 client.AddEventHandler(b.event)
 if client.Store.ID==nil{
  ch,e:=client.GetQRChannel(ctx);require(e)
  go func(){for item:=range ch{b.mu.Lock();b.qr="";if item.Event=="code"{b.qr=item.Code;b.qrExpires=time.Now().Add(item.Timeout)};b.mu.Unlock()}}()
 }
 require(client.Connect())
 mux:=http.NewServeMux()
 mux.HandleFunc("/v1/actions/",b.action)
 mux.HandleFunc("/owner",b.owner)
 mux.HandleFunc("/owner/qr",b.qrImage)
 mux.HandleFunc("/owner/approve",b.approve)
 addr:=os.Getenv("WA_LISTEN");if addr==""{addr="127.0.0.1:8090"}
 server:=&http.Server{Addr:addr,Handler:mux,ReadHeaderTimeout:5*time.Second,ReadTimeout:20*time.Second,WriteTimeout:40*time.Second,IdleTimeout:60*time.Second}
 go func(){<-ctx.Done();shutdown,c:=context.WithTimeout(context.Background(),5*time.Second);defer c();_ = server.Shutdown(shutdown)}()
 log.Print("bridge listening")
 if e=server.ListenAndServe();e!=nil&&e!=http.ErrServerClosed{log.Fatal("HTTP server failed")}
}
func (b *Bridge) action(w http.ResponseWriter,r *http.Request){
 headers(w)
 if r.Method!="POST"{fail(w,405,"POST required");return}
 if !same(r.Header.Get("Authorization"),"Bearer "+b.runtime){fail(w,401,"unauthorized");return}
 var in Input
 d:=json.NewDecoder(http.MaxBytesReader(w,r.Body,16384));d.DisallowUnknownFields()
 if d.Decode(&in)!=nil{fail(w,400,"invalid input");return}
 name:=strings.TrimPrefix(r.URL.Path,"/v1/actions/")
 if name=="get_status"{reply(w,200,map[string]any{"connected":b.client.IsConnected()&&b.client.IsLoggedIn(),"allowedChats":len(b.allow),"sendEnabled":b.sendEnabled,"historyComplete":false});return}
 if in.ChatID!=""&&!b.permitted(in.ChatID){fail(w,403,"chat not allowed");return}
 if in.Limit<1{in.Limit=30};if in.Limit>100{in.Limit=100}
 switch name{
 case "list_chats","search_contacts":
  rows:=[]map[string]string{}
  ids:=make([]string,0,len(b.allow))
  for jid:=range b.allow{ids=append(ids,jid)}
  sort.Strings(ids)
  next:=""
  for _,jid:=range ids{
   if jid<=in.Cursor{continue}
   if name=="search_contacts"&&!strings.Contains(strings.ToLower(jid),strings.ToLower(in.Query)){continue}
   if len(rows)==in.Limit{next=rows[len(rows)-1]["chatId"];break}
   rows=append(rows,map[string]string{"chatId":jid})
  }
  reply(w,200,map[string]any{"chats":rows,"nextCursor":next,"namesAvailable":false})
 case "get_recent_messages","get_messages","search_messages","get_message_context":
  b.read(w,name,in)
 case "get_media": b.media(w,r,in)
 case "send_message":
  if !b.sendEnabled {fail(w,403,"sending disabled by owner");return}
  b.requestSend(w,in)
 default:fail(w,404,"unknown action")
 }
}
func (b *Bridge) filter(in Input)(string,[]any){
 args:=[]any{};ids:=[]string{}
 for id:=range b.allow{ids=append(ids,"?");args=append(args,id)}
 if len(ids)==0{return "0=1",nil}
 where:="chat IN ("+strings.Join(ids,",")+")"
 if in.ChatID!=""{where+=" AND chat=?";args=append(args,in.ChatID)}
 return where,args
}
func (b *Bridge) read(w http.ResponseWriter,name string,in Input){
 where,args:=b.filter(in)
 if name=="get_messages"||name=="get_message_context"{if in.ChatID==""{fail(w,400,"chatId required");return}}
 if name=="search_messages"{if in.Query==""{fail(w,400,"query required");return};where+=" AND instr(lower(body),lower(?))>0";args=append(args,in.Query)}
 if name=="get_message_context"{
  var ts string;if b.db.QueryRow("SELECT ts FROM messages WHERE chat=? AND id=?",in.ChatID,in.MessageID).Scan(&ts)!=nil{fail(w,404,"message not found");return}
  // Return chronologically nearest rows, then sort on agent side.
  q:="SELECT id,chat,sender,body,ts,from_me,media IS NOT NULL FROM messages WHERE "+where+" ORDER BY abs(strftime('%s',ts)-strftime('%s',?)),id LIMIT ?"
  args=append(args,ts,in.Limit);b.query(w,q,args);return
 }
 for _,f:=range []struct{value,op string}{{in.After,">="},{in.Before,"<"}}{
  if f.value!=""{t,e:=time.Parse(time.RFC3339,f.value);if e!=nil{fail(w,400,"invalid timestamp");return};where+=" AND ts "+f.op+" ?";args=append(args,t.UTC().Format(time.RFC3339))}
 }
 if in.Cursor!=""{
  raw,e:=base64.RawURLEncoding.DecodeString(in.Cursor);if e!=nil{fail(w,400,"invalid cursor");return};var parts []string;if json.Unmarshal(raw,&parts)!=nil||len(parts)!=3{fail(w,400,"invalid cursor");return}
  where+=" AND (ts,chat,id)<(?,?,?)";args=append(args,parts[0],parts[1],parts[2])
 }
 q:="SELECT id,chat,sender,body,ts,from_me,media IS NOT NULL FROM messages WHERE "+where+" ORDER BY ts DESC,chat DESC,id DESC LIMIT ?"
 args=append(args,in.Limit);b.query(w,q,args)
}
func (b *Bridge) query(w http.ResponseWriter,q string,args []any){
 rows,e:=b.db.Query(q,args...);if e!=nil{fail(w,500,"query failed");return};defer rows.Close()
 out:=[]Message{}
 for rows.Next(){var m Message;if rows.Scan(&m.ID,&m.ChatID,&m.Sender,&m.Text,&m.Timestamp,&m.FromMe,&m.Media)!=nil{fail(w,500,"query failed");return};out=append(out,m)}
 if rows.Err()!=nil{fail(w,500,"query failed");return}
 cursor:="";if len(out)>0{m:=out[len(out)-1];raw,_:=json.Marshal([]string{m.Timestamp,m.ChatID,m.ID});cursor=base64.RawURLEncoding.EncodeToString(raw)}
 reply(w,200,map[string]any{"messages":out,"nextCursor":cursor,"historyComplete":false})
}
func(b *Bridge) media(w http.ResponseWriter,r *http.Request,in Input){
 if !b.permitted(in.ChatID){fail(w,403,"chat not allowed");return}
 var raw []byte;if b.db.QueryRow("SELECT media FROM messages WHERE chat=? AND id=?",in.ChatID,in.MessageID).Scan(&raw)!=nil||len(raw)==0{fail(w,404,"media unavailable");return}
 msg:=&waE2E.Message{};if proto.Unmarshal(raw,msg)!=nil{fail(w,500,"media unavailable");return}
 var media whatsmeow.DownloadableMessage;var size uint64;var mime string
 switch{case msg.GetImageMessage()!=nil:m:=msg.GetImageMessage();media=m;size=m.GetFileLength();mime=m.GetMimetype()
 case msg.GetDocumentMessage()!=nil:m:=msg.GetDocumentMessage();media=m;size=m.GetFileLength();mime=m.GetMimetype()
 case msg.GetAudioMessage()!=nil:m:=msg.GetAudioMessage();media=m;size=m.GetFileLength();mime=m.GetMimetype()}
 if media==nil||size==0||size>maxMedia{fail(w,413,"unsupported or oversized media");return}
 if !(strings.HasPrefix(mime,"image/")||strings.HasPrefix(mime,"audio/")||mime=="application/pdf"){fail(w,415,"unsupported media");return}
 data,e:=b.client.Download(r.Context(),media);if e!=nil||len(data)>maxMedia{fail(w,502,"media download failed");return}
 reply(w,200,map[string]any{"mimeType":mime,"dataBase64":base64.StdEncoding.EncodeToString(data)})
}
func(b *Bridge) requestSend(w http.ResponseWriter,in Input){
 if !b.permitted(in.ChatID)||in.RequestID==""||len(in.RequestID)>256||in.Text==""||len(in.Text)>4096{fail(w,400,"invalid send request");return}
 _,e:=b.db.Exec("INSERT OR IGNORE INTO requests VALUES(?,?,?,?,?)",in.RequestID,in.ChatID,in.Text,time.Now().Unix(),"pending")
 if e!=nil{fail(w,500,"request failed");return}
 var chat,body,state string;var created int64
 if b.db.QueryRow("SELECT chat,body,state,created FROM requests WHERE id=?",in.RequestID).Scan(&chat,&body,&state,&created)!=nil||chat!=in.ChatID||body!=in.Text{fail(w,409,"idempotency key conflict");return}
 if state=="pending"&&time.Now().Unix()-created>600{state="expired"}
 reply(w,200,map[string]string{"requestId":in.RequestID,"state":state})
}
func(b *Bridge) ownerAuth(w http.ResponseWriter,r *http.Request)bool{
 headers(w)
 user,p,ok:=r.BasicAuth()
 if !ok||user!="owner"||!same(p,b.admin){w.Header().Set("WWW-Authenticate",`Basic realm="WhatsApp owner"`);fail(w,401,"owner authorization required");return false}
 return true
}
var page=template.Must(template.New("owner").Parse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp connection</title></head><body><h1>WhatsApp Personal</h1><p>{{.Status}}</p>{{if .QR}}<img src="/owner/qr" alt="Scan WhatsApp linked-device QR"><p>Open WhatsApp → Linked devices → Link a device. Refresh if expired.</p>{{end}}<h2>Pending send requests</h2>{{range .Requests}}<form method="post" action="/owner/approve"><p>To: {{.Chat}}<br>{{.Text}}</p><input type="hidden" name="csrf" value="{{$.CSRF}}"><input type="hidden" name="id" value="{{.ID}}"><button name="decision" value="approve">Approve exact message</button><button name="decision" value="reject">Reject</button></form>{{else}}<p>No pending requests.</p>{{end}}</body></html>`))
type Pending struct{ ID,Chat,Text string }
func(b *Bridge) owner(w http.ResponseWriter,r *http.Request){
 if !b.ownerAuth(w,r){return};if r.Method!="GET"{fail(w,405,"GET required");return}
 b.mu.RLock();hasQR:=b.qr!=""&&time.Now().Before(b.qrExpires);b.mu.RUnlock()
 status:="Disconnected";if b.client.IsConnected()&&b.client.IsLoggedIn(){status="Connected"}
 pending:=[]Pending{}
 rows,e:=b.db.Query("SELECT id,chat,body FROM requests WHERE state='pending' AND created>=? ORDER BY created LIMIT 30",time.Now().Unix()-600)
 if e==nil{defer rows.Close();for rows.Next(){var p Pending;if rows.Scan(&p.ID,&p.Chat,&p.Text)==nil&&b.permitted(p.Chat){pending=append(pending,p)}}}
 w.Header().Set("Content-Type","text/html; charset=utf-8");_ = page.Execute(w,map[string]any{"Status":status,"QR":hasQR,"CSRF":b.csrf,"Requests":pending})
}
func(b *Bridge) qrImage(w http.ResponseWriter,r *http.Request){
 if !b.ownerAuth(w,r){return};if r.Method!="GET"{fail(w,405,"GET required");return}
 b.mu.RLock();code,expires:=b.qr,b.qrExpires;b.mu.RUnlock()
 if code==""||time.Now().After(expires){fail(w,404,"QR expired");return}
 png,e:=qrcode.Encode(code,qrcode.Medium,360);if e!=nil{fail(w,500,"QR unavailable");return}
 w.Header().Set("Content-Type","image/png");_,_=w.Write(png)
}
func(b *Bridge) approve(w http.ResponseWriter,r *http.Request){
 if !b.ownerAuth(w,r){return};if r.Method!="POST"{fail(w,405,"POST required");return}
 r.Body=http.MaxBytesReader(w,r.Body,4096);if r.ParseForm()!=nil||!same(r.Form.Get("csrf"),b.csrf){fail(w,403,"invalid approval");return}
 id,decision:=r.Form.Get("id"),r.Form.Get("decision")
 var chat,body string;var created int64
 if b.db.QueryRow("SELECT chat,body,created FROM requests WHERE id=? AND state='pending'",id).Scan(&chat,&body,&created)!=nil||time.Now().Unix()-created>600||!b.permitted(chat){fail(w,409,"request unavailable");return}
 if decision=="reject"{_,_=b.db.Exec("UPDATE requests SET state='rejected' WHERE id=? AND state='pending'",id);http.Redirect(w,r,"/owner",303);return}
 if decision!="approve"{fail(w,400,"invalid decision");return}
 if !b.sendEnabled{fail(w,403,"sending disabled by owner");return}
 jid,e:=types.ParseJID(chat);if e!=nil||!b.client.IsLoggedIn(){fail(w,409,"not connected or invalid chat");return}
 res,e:=b.db.Exec("UPDATE requests SET state='sending' WHERE id=? AND state='pending'",id);if e!=nil{fail(w,500,"approval failed");return};n,_:=res.RowsAffected();if n!=1{fail(w,409,"already handled");return}
 _,e=b.client.SendMessage(r.Context(),jid,&waE2E.Message{Conversation:proto.String(body)})
 state:="sent";if e!=nil{state="unknown"}
 _,_=b.db.Exec("UPDATE requests SET state=? WHERE id=?",state,id)
 // Never automatically retry an ambiguous send.
 if e!=nil{fail(w,502,"delivery uncertain; inspect WhatsApp before retrying");return}
 http.Redirect(w,r,"/owner",303)
}
