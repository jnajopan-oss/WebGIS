from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
import json
import os
import urllib.parse
import mysql.connector

PORT = 8000

def get_db_connection():
    print("DB: Attempting connection to localhost...")
    try:
        conn = mysql.connector.connect(
            host="localhost",
            user="root",
            password="",
            database="webgis"
        )
        print("DB: Connection successful!")
        return conn
    except Exception as e:
        print(f"DB: Connection failed! Error: {e}")
        raise e

class WebGISHandler(BaseHTTPRequestHandler):
    def send_json(self, data, status=200):
        print(f"API: Sending JSON response for {self.path} (status {status})")
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
        print(f"API: Response sent successfully.")

    def do_OPTIONS(self):
        # Handle CORS preflight
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        print(f"HTTP: GET request received for {self.path}")
        # API Routes
        if self.path == '/api/data':
            self.handle_get_data()
        elif self.path == '/api/admin/surveyors':
            self.handle_get_surveyors()
        elif self.path == '/api/admin/licenses':
            self.handle_get_licenses()
        elif self.path == '/api/admin/leads':
            self.handle_get_leads()
        elif self.path == '/api/admin/logs':
            # Stub return, logs handled dynamically
            self.send_json({"logs": []})
        else:
            # Static File Serving
            self.handle_static_files()

    def do_POST(self):
        print(f"HTTP: POST request received for {self.path}")
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        payload = {}
        if post_data:
            try:
                payload = json.loads(post_data.decode('utf-8'))
            except:
                pass

        if self.path == '/api/auth/login':
            self.handle_login(payload)
        elif self.path == '/api/auth/register':
            self.handle_register(payload)
        elif self.path == '/api/auth/logout':
            self.handle_logout(payload)
        elif self.path == '/api/data/sync':
            self.handle_sync_data(payload)
        elif self.path == '/api/admin/license/create':
            self.handle_create_license(payload)
        elif self.path == '/api/admin/license/delete':
            self.handle_delete_license(payload)
        elif self.path == '/api/admin/sql':
            self.handle_execute_sql(payload)
        else:
            self.send_json({"success": False, "message": "API endpoint not found"}, 404)

    # ================= STATIC FILES HANDLING =================
    def handle_static_files(self):
        path = self.path.split('?')[0]
        if path == '/' or path == '':
            path = '/index.html'

        # Map correct files inside directory
        file_path = "." + path
        if not os.path.exists(file_path) or os.path.isdir(file_path):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"404 - File Not Found")
            return

        # Content-type detection
        content_type = 'text/html'
        if file_path.endswith('.css'):
            content_type = 'text/css'
        elif file_path.endswith('.js'):
            content_type = 'application/javascript'
        elif file_path.endswith('.json'):
            content_type = 'application/json'
        elif file_path.endswith('.png'):
            content_type = 'image/png'
        elif file_path.endswith('.jpg') or file_path.endswith('.jpeg'):
            content_type = 'image/jpeg'
        elif file_path.endswith('.ico'):
            content_type = 'image/x-icon'

        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.end_headers()

        with open(file_path, 'rb') as f:
            self.wfile.write(f.read())

    # ================= API ENDPOINTS LOGIC =================
    
    def handle_login(self, payload):
        email = payload.get('email', '').strip()
        password = payload.get('password', '')
        device = payload.get('device', 'PC/Desktop')

        if not email or not password:
            self.send_json({"success": False, "message": "Email dan password wajib diisi"}, 400)
            return

        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
            user = cursor.fetchone()

            if not user:
                self.send_json({"success": False, "message": "Email tidak terdaftar!"}, 400)
                return

            if user['password'] != password:
                self.send_json({"success": False, "message": "Password salah!"}, 400)
                return

            # Update device and status to Online
            cursor.execute(
                "UPDATE users SET status = 'Online', device = %s WHERE email = %s",
                (device, user['email'])
            )
            conn.commit()
            
            # Remove password field from response
            del user['password']
            user['device'] = device
            user['status'] = 'Online'

            self.send_json({"success": True, "user": user})
            
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 500)

    def handle_register(self, payload):
        email = payload.get('email', '').strip()
        name = payload.get('name', '').strip()
        password = payload.get('password', '')

        if not email or not name or not password:
            self.send_json({"success": False, "message": "Semua kolom wajib diisi"}, 400)
            return

        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True)
            
            # Check exist
            cursor.execute("SELECT email FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
            if cursor.fetchone():
                self.send_json({"success": False, "message": "Email sudah terdaftar!"}, 400)
                return

            # Insert new user with default license
            cursor.execute(
                "INSERT INTO users (email, name, role, license, device, status, password) "
                "VALUES (%s, %s, 'user', 'NusaGIS-2026', 'PC/Mobile Device', 'Online', %s)",
                (email, name, password)
            )
            conn.commit()
            
            self.send_json({"success": True, "message": "Daftar Akun Berhasil!"})
            
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 500)

    def handle_logout(self, payload):
        email = payload.get('email', '').strip()
        if not email:
            self.send_json({"success": False, "message": "Email required"}, 400)
            return
        
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("UPDATE users SET status = 'Offline' WHERE email = %s", (email,))
            conn.commit()
            self.send_json({"success": True, "message": "Logged out successfully"})
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 500)

    def handle_get_data(self):
        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True)

            # Get points
            cursor.execute("SELECT * FROM survey_points")
            db_points = cursor.fetchall()
            points = []
            for p in db_points:
                try:
                    props = json.loads(p['properties'])
                except:
                    props = {}
                props['name'] = p['name']
                props['elevation'] = p['elevation']
                props['solution'] = p['solution']
                props['time'] = p['time']
                props['surveyor'] = p['surveyor']
                
                points.append({
                    "type": "Feature",
                    "id": p['id'],
                    "geometry": {
                        "type": "Point",
                        "coordinates": [p['longitude'], p['latitude']]
                    },
                    "properties": props
                })

            # Get lines
            cursor.execute("SELECT * FROM digitized_lines")
            db_lines = cursor.fetchall()
            lines = []
            for l in db_lines:
                try:
                    props = json.loads(l['properties'])
                    geom = json.loads(l['geometry'])
                except:
                    props = {}
                    geom = {"type": "LineString", "coordinates": []}
                lines.append({
                    "type": "Feature",
                    "id": l['id'],
                    "geometry": geom,
                    "properties": props
                })

            # Get polygons
            cursor.execute("SELECT * FROM digitized_polygons")
            db_polys = cursor.fetchall()
            polys = []
            for poly in db_polys:
                try:
                    props = json.loads(poly['properties'])
                    geom = json.loads(poly['geometry'])
                except:
                    props = {}
                    geom = {"type": "Polygon", "coordinates": []}
                polys.append({
                    "type": "Feature",
                    "id": poly['id'],
                    "geometry": geom,
                    "properties": props
                })

            self.send_json({
                "survey_points": points,
                "digitized_lines": lines,
                "digitized_polygons": polys,
                "stats": {
                    "points": len(points),
                    "lines": len(lines),
                    "polygons": len(polys)
                }
            })
            
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 500)

    def handle_sync_data(self, payload):
        points = payload.get('survey_points', [])
        lines = payload.get('digitized_lines', [])
        polys = payload.get('digitized_polygons', [])

        try:
            conn = get_db_connection()
            cursor = conn.cursor()

            # Truncate tables for a clean sync replacement
            cursor.execute("DELETE FROM survey_points")
            cursor.execute("DELETE FROM digitized_lines")
            cursor.execute("DELETE FROM digitized_polygons")

            # Insert points
            for p in points:
                coords = p['geometry']['coordinates']
                props = p['properties']
                props_str = json.dumps(props)
                cursor.execute(
                    "INSERT INTO survey_points (id, name, latitude, longitude, elevation, solution, properties, time, surveyor) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (p['id'], props.get('name', 'Point'), coords[1], coords[0], props.get('elevation', 0), props.get('solution', 'Fix'), props_str, props.get('time', ''), props.get('surveyor', 'Guest'))
                )

            # Insert lines
            for l in lines:
                props_str = json.dumps(l['properties'])
                geom_str = json.dumps(l['geometry'])
                cursor.execute(
                    "INSERT INTO digitized_lines (id, name, geometry, properties) VALUES (%s, %s, %s, %s)",
                    (l['id'], l['properties'].get('name', 'Line'), geom_str, props_str)
                )

            # Insert polygons
            for poly in polys:
                props_str = json.dumps(poly['properties'])
                geom_str = json.dumps(poly['geometry'])
                cursor.execute(
                    "INSERT INTO digitized_polygons (id, name, geometry, properties) VALUES (%s, %s, %s, %s)",
                    (poly['id'], poly['properties'].get('name', 'Polygon'), geom_str, props_str)
                )

            conn.commit()
            self.send_json({"success": True, "message": "Synchronized successfully"})
            
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 500)

    def handle_get_surveyors(self):
        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT name, email, license, device, status FROM users")
            users = cursor.fetchall()
            self.send_json(users)
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 500)

    def handle_get_licenses(self):
        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM licenses")
            lics = cursor.fetchall()
            self.send_json(lics)
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 500)

    def handle_create_license(self, payload):
        code = payload.get('code', '').strip()
        client = payload.get('client', '').strip()
        quota = int(payload.get('quota', 10))

        if not code or not client:
            self.send_json({"success": False, "message": "Missing key details"}, 400)
            return

        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO licenses (code, client, quota, used, status) VALUES (%s, %s, %s, 0, 'Active')",
                (code, client, quota)
            )
            conn.commit()
            self.send_json({"success": True, "message": "License generated!"})
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 500)

    def handle_delete_license(self, payload):
        code = payload.get('code', '').strip()
        if not code:
            self.send_json({"success": False, "message": "Code required"}, 400)
            return

        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM licenses WHERE code = %s", (code,))
            conn.commit()
            self.send_json({"success": True, "message": "License deleted"})
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 500)

    def handle_get_leads(self):
        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM leads")
            leads = cursor.fetchall()
            self.send_json(leads)
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 500)

    def handle_execute_sql(self, payload):
        query = payload.get('query', '').strip()
        if not query:
            self.send_json({"success": False, "message": "Kueri SQL kosong!"}, 400)
            return

        try:
            conn = get_db_connection()
            # Set dictionary=True to return rows as dictionaries for easy representation
            cursor = conn.cursor(dictionary=True)
            cursor.execute(query)
            
            # Check if query returns rows (SELECT) or affects rows (UPDATE, INSERT, etc.)
            if query.upper().startswith('SELECT') or query.upper().startswith('SHOW') or query.upper().startswith('DESCRIBE'):
                rows = cursor.fetchall()
                # Extract column headings
                columns = [desc[0] for desc in cursor.description] if cursor.description else []
                self.send_json({"success": True, "columns": columns, "rows": rows})
            else:
                conn.commit()
                affected = cursor.rowcount
                self.send_json({
                    "success": True, 
                    "columns": ["message", "rows_affected"], 
                    "rows": [{"message": "Kueri SQL berhasil dieksekusi", "rows_affected": affected}]
                })
            
            cursor.close()
            conn.close()
        except Exception as e:
            self.send_json({"success": False, "message": str(e)}, 400) # 400 client SQL error

def run_server():
    server_address = ('', PORT)
    httpd = ThreadingHTTPServer(server_address, WebGISHandler)
    print(f"NusaGIS WebGIS Python server running on port {PORT}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("Stopping server...")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
