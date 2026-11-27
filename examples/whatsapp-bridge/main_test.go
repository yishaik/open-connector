package main

import (
 "database/sql"
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"
)
func TestRuntimeAndOwnerIsolation(t *testing.T) {
 b:=&Bridge{runtime:strings.Repeat("r",32),admin:strings.Repeat("a",32),allow:map[string]bool{}}
 r:=httptest.NewRequest("POST","/v1/actions/get_messages",strings.NewReader("{}"))
 w:=httptest.NewRecorder();b.action(w,r);if w.Code!=http.StatusUnauthorized{t.Fatal(w.Code)}
 r=httptest.NewRequest("GET","/owner/qr",nil);r.Header.Set("Authorization","Bearer "+b.runtime)
 w=httptest.NewRecorder();b.qrImage(w,r);if w.Code!=http.StatusUnauthorized{t.Fatal(w.Code)}
 r=httptest.NewRequest("POST","/v1/actions/get_messages",strings.NewReader(`{"chatId":"not-allowed"}`));r.Header.Set("Authorization","Bearer "+b.runtime)
 w=httptest.NewRecorder();b.action(w,r);if w.Code!=http.StatusForbidden{t.Fatal(w.Code)}
}
func TestEmptyAllowlist(t *testing.T) {
 db,e:=sql.Open("sqlite3",":memory:");if e!=nil{t.Fatal(e)};defer db.Close()
 b:=&Bridge{db:db,allow:map[string]bool{}}
 where,args:=b.filter(Input{});if where!="0=1"||len(args)!=0{t.Fatal("empty allowlist must deny")}
}
func TestSendIsOnlyQueued(t *testing.T) {
 db,e:=sql.Open("sqlite3",":memory:");if e!=nil{t.Fatal(e)};defer db.Close()
 _,e=db.Exec("CREATE TABLE requests(id TEXT PRIMARY KEY,chat TEXT,body TEXT,created INTEGER,state TEXT)");if e!=nil{t.Fatal(e)}
 b:=&Bridge{db:db,allow:map[string]bool{"allowed":true}}
 in:=Input{ChatID:"allowed",Text:"test",RequestID:"unique"}
 w:=httptest.NewRecorder();b.requestSend(w,in);if w.Code!=200||!strings.Contains(w.Body.String(),"pending"){t.Fatal(w.Code)}
 in.Text="changed";w=httptest.NewRecorder();b.requestSend(w,in);if w.Code!=409{t.Fatal(w.Code)}
}

func TestSendDisabledByDefault(t *testing.T) {
 b:=&Bridge{runtime:strings.Repeat("r",32),allow:map[string]bool{"allowed":true}}
 r:=httptest.NewRequest("POST","/v1/actions/send_message",strings.NewReader(`{"chatId":"allowed","text":"test","requestId":"unique"}`))
 r.Header.Set("Authorization","Bearer "+b.runtime)
 w:=httptest.NewRecorder();b.action(w,r)
 if w.Code!=http.StatusForbidden{t.Fatal(w.Code)}
}

func TestDisconnectedSessionCannotReadArchive(t *testing.T) {
 b:=&Bridge{runtime:strings.Repeat("r",32),allow:map[string]bool{"allowed":true}}
 for _,name:=range []string{"list_chats","search_contacts","get_messages","get_recent_messages","search_messages","get_message_context","get_media"} {
  r:=httptest.NewRequest("POST","/v1/actions/"+name,strings.NewReader(`{"chatId":"allowed"}`))
  r.Header.Set("Authorization","Bearer "+b.runtime)
  w:=httptest.NewRecorder();b.action(w,r)
  if w.Code!=http.StatusConflict{t.Fatalf("%s: %d",name,w.Code)}
 }
}

func TestOwnerPairingProtected(t *testing.T) {
 b:=&Bridge{runtime:strings.Repeat("r",32),admin:strings.Repeat("a",32),csrf:"test-csrf",allow:map[string]bool{}}
 for _,tc:=range []struct{auth,body string;want int}{
  {"","operation=generate&csrf=test-csrf",401},
  {"runtime","operation=generate&csrf=test-csrf",401},
  {"owner","operation=generate&csrf=wrong",403},
  {"owner","operation=generate&csrf=test-csrf",303},
 }{
  r:=httptest.NewRequest("POST","/owner",strings.NewReader(tc.body));r.Header.Set("Content-Type","application/x-www-form-urlencoded")
  if tc.auth=="owner"{r.SetBasicAuth("owner",b.admin)}else if tc.auth=="runtime"{r.Header.Set("Authorization","Bearer "+b.runtime)}
  w:=httptest.NewRecorder();b.owner(w,r);if w.Code!=tc.want{t.Fatalf("%s: got %d want %d",tc.auth,w.Code,tc.want)}
 }
}
func TestOwnerPageAndStatus(t *testing.T) {
 b:=&Bridge{admin:strings.Repeat("a",32),csrf:"test-csrf",pairState:"ready"}
 for _,path:=range []string{"/owner","/owner?format=status"}{
  r:=httptest.NewRequest("GET",path,nil);r.SetBasicAuth("owner",b.admin)
  w:=httptest.NewRecorder();b.owner(w,r);if w.Code!=200{t.Fatal(w.Code)}
  if path=="/owner"{
   if !strings.Contains(w.Body.String(),"Generate QR")||!strings.Contains(w.Body.String(),"nonce=")||!strings.Contains(w.Header().Get("Content-Security-Policy"),"script-src 'nonce-"){t.Fatal("owner controls missing")}
  }else if !strings.Contains(w.Body.String(),"\"status\":\"Disconnected\""){t.Fatal("missing status")}
 }
}
