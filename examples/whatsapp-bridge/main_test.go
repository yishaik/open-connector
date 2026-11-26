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
