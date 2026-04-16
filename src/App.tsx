/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Plus, MapPin, Route, Trash2, Loader2, Navigation, MessageSquare, X, Send, LocateFixed, Settings, Save, FolderOpen, CheckCircle, ExternalLink, GripVertical, Truck, WifiOff } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});
import { DragDropContext, Droppable, Draggable as OriginalDraggable } from '@hello-pangea/dnd';
const Draggable: any = OriginalDraggable;

const getApiKey = () => {
  if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  try {
    return (import.meta as any).env.VITE_GEMINI_API_KEY || '';
  } catch (e) {
    return '';
  }
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });

const mapContainerStyle = {
  width: '100%',
  height: '100%'
};

const defaultCenter = {
  lat: 41.8719, // Center of Italy
  lng: 12.5674
};

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#161618" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#161618" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8E8E93" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#C5A059" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#8E8E93" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0A0A0B" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#8E8E93" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2C2C2E" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#161618" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8E8E93" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#C5A059" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#161618" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#F2F2F7" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2C2C2E" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#F2F2F7" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0A0A0B" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#8E8E93" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#161618" }] },
];

interface RouteStop {
  address: string;
  travelTime?: string;
  distance?: string;
  order: number;
}

const LeafletMapWrapper = ({ optimizedRoute, completedStops }: { optimizedRoute: RouteStop[] | null, completedStops: string[] }) => {
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [markers, setMarkers] = useState<{lat: number, lng: number, address: string, order: number}[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchRoute = async () => {
      const activeRoute = optimizedRoute?.filter(stop => !completedStops.includes(stop.address)) || null;
      if (!activeRoute || activeRoute.length < 2) {
        setRouteCoordinates([]);
        setMarkers([]);
        return;
      }

      setIsLoading(true);
      try {
        // 1. Geocode all addresses
        const coords: {lat: number, lng: number, address: string, order: number}[] = [];
        for (const stop of activeRoute) {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(stop.address)}&limit=1`);
          const data = await res.json();
          if (data && data.length > 0) {
            coords.push({
              lat: parseFloat(data[0].lat),
              lng: parseFloat(data[0].lon),
              address: stop.address,
              order: stop.order
            });
          }
          // Sleep to respect Nominatim rate limits (1 req/s)
          await new Promise(r => setTimeout(r, 1000));
        }

        setMarkers(coords);

        if (coords.length >= 2) {
          // 2. Get route from OSRM
          const coordinatesString = coords.map(c => `${c.lng},${c.lat}`).join(';');
          const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinatesString}?overview=full&geometries=geojson`);
          const osrmData = await osrmRes.json();

          if (osrmData.code === 'Ok' && osrmData.routes.length > 0) {
            const routeGeoJSON = osrmData.routes[0].geometry.coordinates;
            // OSRM returns [lng, lat], Leaflet expects [lat, lng]
            const latLngs: [number, number][] = routeGeoJSON.map((c: number[]) => [c[1], c[0]]);
            setRouteCoordinates(latLngs);
          } else {
            // Fallback to straight lines
            setRouteCoordinates(coords.map(c => [c.lat, c.lng]));
          }
        }
      } catch (error) {
        console.error("Error fetching route:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRoute();
  }, [optimizedRoute, completedStops]);

  // Component to auto-fit bounds
  const MapBounds = () => {
    const map = useMap();
    useEffect(() => {
      if (routeCoordinates.length > 0) {
        const bounds = L.latLngBounds(routeCoordinates);
        map.fitBounds(bounds, { padding: [50, 50] });
      } else if (markers.length > 0) {
        const bounds = L.latLngBounds(markers.map(m => [m.lat, m.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }, [map, routeCoordinates, markers]);
    return null;
  };

  return (
    <div className="w-full h-full relative">
      {isLoading && (
        <div className="absolute inset-0 z-[1000] bg-black/50 flex flex-col items-center justify-center backdrop-blur-sm">
          <Loader2 className="w-8 h-8 text-theme-accent animate-spin mb-4" />
          <p className="text-theme-text-primary">Calcolo percorso su mappa in corso...</p>
        </div>
      )}
      <MapContainer 
        center={[41.8719, 12.5674]} 
        zoom={6} 
        style={{ width: '100%', height: '100%', background: '#0A0A0B' }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <MapBounds />
        
        {routeCoordinates.length > 0 && (
          <Polyline 
            positions={routeCoordinates} 
            color="#C5A059" 
            weight={4} 
            opacity={0.8} 
          />
        )}

        {markers.map((marker, idx) => (
          <Marker key={idx} position={[marker.lat, marker.lng]}>
            <Popup>
              <div className="text-black">
                <strong>Fermata {marker.order}</strong><br/>
                {marker.address}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default function App() {
  const [addresses, setAddresses] = useState<string[]>(() => {
    const saved = localStorage.getItem('activeAddresses');
    return saved ? JSON.parse(saved) : [];
  });
  const [currentInput, setCurrentInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizedRoute, setOptimizedRoute] = useState<RouteStop[] | null>(() => {
    const saved = localStorage.getItem('activeOptimizedRoute');
    return saved ? JSON.parse(saved) : null;
  });
  const [error, setError] = useState('');
  const recognitionRef = useRef<any>(null);

  // New features state
  const [vehicleProfile, setVehicleProfile] = useState({ height: '', weight: '', hazardous: false });
  const [showSettings, setShowSettings] = useState(false);
  const [completedStops, setCompletedStops] = useState<string[]>(() => {
    const saved = localStorage.getItem('activeCompletedStops');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Persist active state for offline support
  useEffect(() => {
    localStorage.setItem('activeAddresses', JSON.stringify(addresses));
  }, [addresses]);

  useEffect(() => {
    localStorage.setItem('activeOptimizedRoute', JSON.stringify(optimizedRoute));
  }, [optimizedRoute]);

  useEffect(() => {
    localStorage.setItem('activeCompletedStops', JSON.stringify(completedStops));
  }, [completedStops]);
  const [savedRoutes, setSavedRoutes] = useState<{name: string, addresses: string[]}[]>([]);
  const [showSavedRoutes, setShowSavedRoutes] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('savedRoutes');
    if (saved) {
      try { setSavedRoutes(JSON.parse(saved)); } catch (e) {}
    }
  }, []);

  // Chat state
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', text: string}[]>([
    { role: 'model', text: 'Ciao! Sono il tuo assistente logistico. Come posso aiutarti oggi?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatRef = useRef<any>(null);

  // Initialize chat
  useEffect(() => {
    chatRef.current = ai.chats.create({
      model: 'gemini-3-flash-preview',
      config: {
        systemInstruction: "Sei un assistente esperto in logistica e gestione delle consegne. Rispondi in modo conciso, professionale e in italiano. Aiuti l'utente a gestire i percorsi e fornisci informazioni utili."
      }
    });
  }, []);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'it-IT';
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setError('');
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        if (finalTranscript) {
          setCurrentInput((prev) => {
            const space = prev && !prev.endsWith(' ') ? ' ' : '';
            return prev + space + finalTranscript;
          });
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setError(`Errore vocale: ${event.error}`);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      if (!recognitionRef.current) {
        setError('Il tuo browser non supporta il riconoscimento vocale.');
        return;
      }
      recognitionRef.current.start();
    }
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('La geolocalizzazione non è supportata dal tuo browser.');
      return;
    }

    setIsLocating(true);
    setError('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setAddresses(prev => [...prev, `Posizione Attuale (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`]);
        setIsLocating(false);
      },
      (err) => {
        console.error("Geolocation error:", err);
        setError(`Errore GPS: ${err.message}`);
        setIsLocating(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const addAddress = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (currentInput.trim()) {
      setAddresses([...addresses, currentInput.trim()]);
      setCurrentInput('');
      setOptimizedRoute(null);
    }
  };

  const removeAddress = (index: number) => {
    setAddresses(addresses.filter((_, i) => i !== index));
    setOptimizedRoute(null);
  };

  const onDragEnd = (result: any) => {
    if (!result.destination) return;
    const items = Array.from(addresses);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setAddresses(items);
    setOptimizedRoute(null);
  };

  const saveCurrentRoute = () => {
    if (addresses.length === 0) return;
    const name = window.prompt("Inserisci un nome per questo percorso (es. 'Giro del Lunedì'):");
    if (name) {
      const newRoutes = [...savedRoutes, { name, addresses }];
      setSavedRoutes(newRoutes);
      localStorage.setItem('savedRoutes', JSON.stringify(newRoutes));
    }
  };

  const loadRoute = (routeAddresses: string[]) => {
    setAddresses(routeAddresses);
    setOptimizedRoute(null);
    setCompletedStops([]);
    setShowSavedRoutes(false);
  };

  const toggleStopCompletion = (address: string) => {
    setCompletedStops(prev => 
      prev.includes(address) ? prev.filter(a => a !== address) : [...prev, address]
    );
  };

  const exportToMaps = () => {
    if (!optimizedRoute) return;
    const activeRoute = optimizedRoute.filter(stop => !completedStops.includes(stop.address));
    if (activeRoute.length < 2) return;
    
    const origin = encodeURIComponent(activeRoute[0].address);
    const destination = encodeURIComponent(activeRoute[activeRoute.length - 1].address);
    const waypoints = activeRoute.slice(1, -1).map(s => encodeURIComponent(s.address)).join('|');
    
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=driving`;
    window.open(url, '_blank');
  };

  const optimizeRoute = async () => {
    if (addresses.length < 2) {
      setError('Inserisci almeno 2 indirizzi per ottimizzare il percorso.');
      return;
    }

    setIsOptimizing(true);
    setError('');
    setCompletedStops([]);

    try {
      const prompt = `
        Sei un assistente per l'ottimizzazione dei percorsi di consegna.
        Usa Google Maps per trovare il percorso più veloce per visitare i seguenti indirizzi in Italia:
        ${addresses.map((a, i) => `${i + 1}. ${a}`).join('\n')}

        ATTENZIONE: Il percorso DEVE essere calcolato e ottimizzato specificamente per MEZZI PESANTI (camion/tir).
        Profilo Veicolo:
        - Altezza: ${vehicleProfile.height ? vehicleProfile.height + 'm' : 'Standard'}
        - Peso: ${vehicleProfile.weight ? vehicleProfile.weight + 't' : 'Standard'}
        - Merci Pericolose: ${vehicleProfile.hazardous ? 'Sì' : 'No'}
        Tieni conto delle probabili restrizioni di peso, altezza, divieti di transito per mezzi pesanti e preferisci strade principali o autostrade adatte a questo tipo di veicoli.

        VINCOLI DI ORARIO: Se un indirizzo contiene un vincolo di orario (es. "entro le 12", "tra le 10 e le 11", "tassativamente alle 15"), DEVI assolutamente rispettarlo nell'ordinamento del percorso, anche se significa allungare il tragitto.

        Il punto di partenza è il primo indirizzo: ${addresses[0]}.
        Calcola il percorso ottimizzato che minimizza il tempo di viaggio totale visitando tutti i punti.
        
        DEVI RESTITUIRE ESATTAMENTE E SOLO UN ARRAY JSON VALIDO (senza markdown, senza \`\`\`json) con questo formato:
        [
          {
            "address": "L'indirizzo di consegna formattato correttamente",
            "travelTime": "Tempo stimato dal punto precedente (es. '10 min'). Vuoto per il punto di partenza.",
            "distance": "Distanza dal punto precedente (es. '5 km'). Vuoto per il punto di partenza.",
            "order": 1
          }
        ]
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          tools: [{ googleMaps: {} }]
        }
      });

      if (response.text) {
        // Rimuovi eventuali blocchi markdown se il modello li inserisce comunque
        const jsonStr = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const route = JSON.parse(jsonStr) as RouteStop[];
        setOptimizedRoute(route.sort((a, b) => a.order - b.order));
      } else {
        setError('Impossibile generare il percorso. Riprova.');
      }
    } catch (err: any) {
      console.error(err);
      setError(`Errore durante l'ottimizzazione: ${err.message}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userText = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsChatLoading(true);

    try {
      const response = await chatRef.current.sendMessage({ message: userText });
      setChatMessages(prev => [...prev, { role: 'model', text: response.text }]);
    } catch (error) {
      console.error("Chat error:", error);
      setChatMessages(prev => [...prev, { role: 'model', text: "Scusa, si è verificato un errore di connessione." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-theme-bg text-theme-text-primary font-sans">
      <header className="h-[80px] px-10 flex items-center justify-between border-b border-theme-border bg-theme-surface shrink-0">
        <div className="font-display text-2xl italic text-theme-accent tracking-[1px]">ROUTEMASTER ELITE</div>
        <div className="flex items-center gap-4 text-sm text-theme-text-secondary">
          <button onClick={() => setShowSavedRoutes(true)} className="hover:text-theme-accent transition-colors flex items-center gap-2" title="Percorsi Salvati">
            <FolderOpen className="w-5 h-5" />
          </button>
          <button onClick={() => setShowSettings(true)} className="hover:text-theme-accent transition-colors flex items-center gap-2" title="Profilo Veicolo">
            <Truck className="w-5 h-5" />
          </button>
          <div className="w-[1px] h-6 bg-theme-border mx-2"></div>
          <span>Logistica Milano Nord</span>
          <div className="w-8 h-8 rounded-full bg-theme-accent border border-theme-border"></div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 md:grid-cols-[350px_1fr] gap-[1px] bg-theme-border overflow-hidden">
        {/* Sidebar */}
        <section className="bg-theme-bg p-[30px] flex flex-col gap-6 overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-2.5">
            <label className="font-display text-xs uppercase tracking-[2px] text-theme-accent">Nuova Consegna</label>
            <form onSubmit={addAddress} className="relative">
              <input
                type="text"
                value={currentInput}
                onChange={(e) => setCurrentInput(e.target.value)}
                placeholder="Inserisci o detta indirizzo..."
                className="w-full bg-theme-surface border border-theme-border py-[14px] pl-4 pr-[80px] text-white rounded focus:outline-none focus:border-theme-accent transition-colors text-sm"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={getCurrentLocation}
                  disabled={isLocating}
                  className={`bg-transparent border-none cursor-pointer transition-colors ${
                    isLocating ? 'text-theme-accent' : 'text-theme-text-secondary hover:text-white'
                  }`}
                  title="Usa posizione attuale"
                >
                  {isLocating ? <Loader2 className="w-5 h-5 animate-spin" /> : <LocateFixed className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`bg-transparent border-none cursor-pointer transition-colors ${
                    isListening ? 'text-red-500 animate-pulse' : 'text-theme-accent hover:text-white'
                  }`}
                  title="Parla per inserire"
                >
                  {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>
              </div>
            </form>
            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
          </div>

          <div className="flex-1 flex flex-col gap-3 overflow-hidden">
            <div className="flex justify-between items-center shrink-0">
              <label className="font-display text-xs uppercase tracking-[2px] text-theme-accent">Percorso Attuale</label>
              {addresses.length > 0 && (
                <button onClick={saveCurrentRoute} className="text-theme-text-secondary hover:text-theme-accent transition-colors flex items-center gap-1 text-xs">
                  <Save className="w-3 h-3" /> Salva
                </button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
              {addresses.length === 0 ? (
                <div className="text-theme-text-secondary text-sm italic py-4">Nessun indirizzo inserito.</div>
              ) : (
                <DragDropContext onDragEnd={onDragEnd}>
                  <Droppable droppableId="addresses">
                    {(provided) => (
                      <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col gap-3">
                        <AnimatePresence>
                          {addresses.map((address, idx) => (
                            <Draggable key={address + idx} draggableId={address + idx} index={idx}>
                              {(provided: any) => (
                                <motion.div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, height: 0 }}
                                  className="p-4 bg-theme-surface border-l-2 border-theme-accent text-[13px] flex justify-between items-center group shrink-0"
                                >
                                  <div className="flex items-center gap-3">
                                    <div {...provided.dragHandleProps} className="text-theme-text-secondary hover:text-white cursor-grab active:cursor-grabbing">
                                      <GripVertical className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <div className="text-theme-text-primary">{address}</div>
                                      <span className="text-theme-text-secondary text-[11px] block mt-1">
                                        {idx === 0 ? 'Punto di partenza' : `Consegna #${100 + idx}`}
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => removeAddress(idx)}
                                    className="text-theme-text-secondary hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </motion.div>
                              )}
                              </Draggable>
                          ))}
                        </AnimatePresence>
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}
            </div>
          </div>

          <button
            onClick={optimizeRoute}
            disabled={isOptimizing || addresses.length < 2 || isOffline}
            className="bg-theme-accent text-theme-bg border-none p-4 font-bold uppercase tracking-[1px] cursor-pointer rounded mt-auto hover:bg-opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shrink-0"
          >
            {isOffline 
              ? <><WifiOff className="w-5 h-5"/> Offline</> 
              : isOptimizing 
                ? <Loader2 className="w-5 h-5 animate-spin" /> 
                : (optimizedRoute ? 'Ricalcola Percorso' : 'Calcola Percorso Veloce')}
          </button>
        </section>

        {/* Map Viewport */}
        <section className="bg-[#111] relative flex flex-col overflow-hidden">
          <div className="absolute inset-0 z-0">
            <LeafletMapWrapper optimizedRoute={optimizedRoute} completedStops={completedStops} />
          </div>

          <div className="absolute inset-0 z-10 pointer-events-none p-6 md:p-10 flex flex-col md:flex-row justify-between gap-6">
            
            {optimizedRoute ? (
              <>
                {/* Left Side: Route List */}
                <div className="w-full md:w-[400px] flex flex-col h-full pointer-events-auto">
                  <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar pb-10">
                    <div className="flex flex-col gap-4">
                      {optimizedRoute.map((stop, idx) => {
                        const isCompleted = completedStops.includes(stop.address);
                        return (
                          <motion.div
                            key={stop.address + idx}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            className={`p-4 backdrop-blur-md border rounded-lg flex items-center gap-4 transition-all shadow-lg ${
                              isCompleted ? 'bg-[rgba(48,209,88,0.05)] border-theme-success opacity-60' : 'bg-[rgba(22,22,24,0.85)] border-theme-border'
                            }`}
                          >
                            <button 
                              onClick={() => toggleStopCompletion(stop.address)}
                              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                                isCompleted ? 'bg-theme-success text-theme-bg' : 'bg-theme-surface border border-theme-border text-theme-text-secondary hover:border-theme-accent hover:text-theme-accent'
                              }`}
                            >
                              {isCompleted ? <CheckCircle className="w-5 h-5" /> : stop.order}
                            </button>
                            <div className={`flex-1 ${isCompleted ? 'line-through text-theme-text-secondary' : ''}`}>
                              <div className="text-theme-text-primary font-medium flex items-center gap-2 text-sm">
                                <MapPin className={`w-4 h-4 shrink-0 ${isCompleted ? 'text-theme-success' : 'text-theme-accent'}`} />
                                <span className="line-clamp-2">{stop.address}</span>
                              </div>
                              {(stop.travelTime || stop.distance) && (
                                <div className="flex gap-3 mt-2 text-[10px] text-theme-text-secondary uppercase tracking-wider">
                                  {stop.travelTime && <span>⏱ {stop.travelTime}</span>}
                                  {stop.distance && <span>📏 {stop.distance}</span>}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Right Side: Badges and Stats */}
                <div className="flex flex-col items-end justify-between pointer-events-none">
                  {/* Top Right Badges */}
                  <div className="flex flex-col items-end gap-2 pointer-events-auto">
                    <div className="bg-[rgba(48,209,88,0.15)] text-theme-success border border-theme-success px-4 py-2 rounded-full text-xs uppercase tracking-[1px] font-bold shadow-lg backdrop-blur-sm">
                      Percorso Ottimizzato
                    </div>
                    <div className="bg-[rgba(197,160,89,0.15)] text-theme-accent border border-theme-accent px-4 py-2 rounded-full text-xs uppercase tracking-[1px] font-bold flex items-center gap-1 shadow-lg backdrop-blur-sm">
                      <Navigation className="w-3 h-3" /> Mezzi Pesanti
                    </div>
                    <button onClick={exportToMaps} className="mt-2 bg-theme-surface text-theme-text-primary border border-theme-border px-4 py-2 rounded-full text-xs uppercase tracking-[1px] font-bold flex items-center gap-2 hover:border-theme-accent transition-colors shadow-lg backdrop-blur-sm">
                      <ExternalLink className="w-3 h-3" /> Esporta su Google Maps
                    </button>
                  </div>
                  
                  {/* Bottom Right Stats */}
                  <div className="bg-[rgba(22,22,24,0.9)] backdrop-blur-md p-6 border border-theme-border flex gap-10 rounded-lg pointer-events-auto shadow-2xl mb-10 md:mb-0">
                    <div className="flex flex-col">
                      <h4 className="font-display text-2xl text-theme-text-primary mb-1">
                        {optimizedRoute.length - completedStops.length} <span className="text-sm text-theme-text-secondary">/ {optimizedRoute.length}</span>
                      </h4>
                      <p className="text-theme-text-secondary uppercase text-[10px] tracking-[1px]">Fermate Rimanenti</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-theme-text-secondary">
                <Route className="w-12 h-12 mb-4 opacity-20" />
                <p className="font-display text-xl italic text-theme-accent opacity-50">In attesa di calcolo percorso...</p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Chat Widget */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-28 right-10 w-96 h-[500px] bg-theme-surface border border-theme-border rounded-lg flex flex-col shadow-2xl z-50"
          >
            <div className="p-4 border-b border-theme-border flex justify-between items-center bg-theme-bg rounded-t-lg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-theme-success animate-pulse"></div>
                <span className="font-display text-sm uppercase tracking-[1px] text-theme-accent">Assistente IA</span>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="text-theme-text-secondary hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-lg text-sm ${
                    msg.role === 'user' 
                      ? 'bg-theme-accent text-theme-bg rounded-tr-none' 
                      : 'bg-theme-border text-theme-text-primary rounded-tl-none'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-theme-border text-theme-text-primary p-3 rounded-lg rounded-tl-none flex gap-1 items-center">
                    <div className="w-1.5 h-1.5 bg-theme-text-secondary rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-theme-text-secondary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-1.5 h-1.5 bg-theme-text-secondary rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSendMessage} className="p-3 border-t border-theme-border bg-theme-bg rounded-b-lg flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={isOffline ? "Chat disabilitata offline" : "Chiedi qualcosa..."}
                disabled={isOffline}
                className="flex-1 bg-theme-surface border border-theme-border px-3 py-2 text-white rounded focus:outline-none focus:border-theme-accent transition-colors text-sm disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || isChatLoading || isOffline}
                className="bg-theme-accent text-theme-bg p-2 rounded hover:bg-opacity-90 disabled:opacity-50 transition-colors flex items-center justify-center shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Chat Button */}
      <button
        onClick={() => setIsChatOpen(!isChatOpen)}
        className="fixed bottom-10 right-10 w-14 h-14 bg-theme-accent rounded-full flex items-center justify-center cursor-pointer shadow-[0_0_15px_var(--color-theme-accent)] z-50 text-theme-bg hover:scale-105 transition-transform"
      >
        {isChatOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>

      {/* Modals */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            <div className="bg-theme-surface border border-theme-border rounded-lg w-full max-w-md p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-display text-xl text-theme-accent flex items-center gap-2"><Truck className="w-5 h-5" /> Profilo Veicolo</h3>
                <button onClick={() => setShowSettings(false)} className="text-theme-text-secondary hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-xs text-theme-text-secondary uppercase tracking-[1px] block mb-2">Altezza (metri)</label>
                  <input type="number" step="0.1" value={vehicleProfile.height} onChange={e => setVehicleProfile({...vehicleProfile, height: e.target.value})} placeholder="es. 4.0" className="w-full bg-theme-bg border border-theme-border p-3 text-white rounded focus:border-theme-accent outline-none" />
                </div>
                <div>
                  <label className="text-xs text-theme-text-secondary uppercase tracking-[1px] block mb-2">Peso (tonnellate)</label>
                  <input type="number" step="0.1" value={vehicleProfile.weight} onChange={e => setVehicleProfile({...vehicleProfile, weight: e.target.value})} placeholder="es. 18.5" className="w-full bg-theme-bg border border-theme-border p-3 text-white rounded focus:border-theme-accent outline-none" />
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <input type="checkbox" id="hazardous" checked={vehicleProfile.hazardous} onChange={e => setVehicleProfile({...vehicleProfile, hazardous: e.target.checked})} className="w-4 h-4 accent-theme-accent" />
                  <label htmlFor="hazardous" className="text-sm text-theme-text-primary">Trasporto Merci Pericolose (ADR)</label>
                </div>
                <button onClick={() => setShowSettings(false)} className="mt-4 bg-theme-accent text-theme-bg font-bold py-3 rounded uppercase tracking-[1px] hover:opacity-90">Salva Profilo</button>
              </div>
            </div>
          </motion.div>
        )}

        {showSavedRoutes && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            <div className="bg-theme-surface border border-theme-border rounded-lg w-full max-w-md p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-display text-xl text-theme-accent flex items-center gap-2"><FolderOpen className="w-5 h-5" /> Percorsi Salvati</h3>
                <button onClick={() => setShowSavedRoutes(false)} className="text-theme-text-secondary hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
                {savedRoutes.length === 0 ? (
                  <p className="text-theme-text-secondary text-sm italic text-center py-4">Nessun percorso salvato.</p>
                ) : (
                  savedRoutes.map((route, idx) => (
                    <div key={idx} className="bg-theme-bg border border-theme-border p-4 rounded flex justify-between items-center group">
                      <div>
                        <div className="text-theme-text-primary font-medium">{route.name}</div>
                        <div className="text-theme-text-secondary text-xs mt-1">{route.addresses.length} fermate</div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => loadRoute(route.addresses)} className="bg-theme-surface border border-theme-border text-theme-text-primary px-3 py-1.5 rounded text-xs hover:border-theme-accent transition-colors">Carica</button>
                        <button onClick={() => {
                          const newRoutes = savedRoutes.filter((_, i) => i !== idx);
                          setSavedRoutes(newRoutes);
                          localStorage.setItem('savedRoutes', JSON.stringify(newRoutes));
                        }} className="text-theme-text-secondary hover:text-red-500 p-1.5"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
