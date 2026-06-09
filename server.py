import http.server
import socketserver
import webbrowser
import threading
import os
import sys

PORT = 8200
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def start_server():
    global PORT
    while True:
        try:
            with socketserver.TCPServer(("", PORT), Handler) as httpd:
                print(f"Serving dashboard at http://localhost:{PORT}")
                print("Press Ctrl+C to stop the server.")
                
                # Automatically open web browser after a short delay
                threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{PORT}/index.html")).start()
                
                httpd.serve_forever()
        except OSError:
            PORT += 1
            if PORT > 8300:
                print("Error: Could not find an available port to start the server.")
                sys.exit(1)

if __name__ == "__main__":
    start_server()
