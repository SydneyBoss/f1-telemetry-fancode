/**
 * OpenF1 API Client for Content Script
 * Supports both Background Service Worker messaging (CORS bypass) and direct fetch fallback.
 */

window.OpenF1Client = (function () {
  const BASE_URL = 'https://api.openf1.org/v1';

  // Fallback team colors if missing in API response
  const TEAM_COLORS = {
    'McLaren': '#FF8000',
    'Ferrari': '#E80020',
    'Red Bull Racing': '#3671C6',
    'Mercedes': '#27F4D2',
    'Aston Martin': '#229971',
    'Alpine': '#FF87BC',
    'Williams': '#64C4FF',
    'Haas F1 Team': '#B6BABD',
    'Kick Sauber': '#52E252',
    'RB': '#6692FF'
  };

  async function apiRequest(endpoint, params = {}) {
    // If running inside browser extension with chrome.runtime
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'FETCH_OPENF1', endpoint, params }, res => {
            if (chrome.runtime.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            if (!res || !res.success) {
              return reject(new Error(res?.error || 'Unknown extension message error'));
            }
            resolve(res.data);
          });
        });
        return response;
      } catch (err) {
        console.warn('[OpenF1Client] Background message failed, attempting direct fetch:', err);
      }
    }

    // Direct fetch fallback (for local demo or dev)
    const url = new URL(`${BASE_URL}/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        url.searchParams.append(k, v);
      }
    });

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`OpenF1 HTTP error: ${res.status}`);
    }
    return await res.json();
  }

  return {
    TEAM_COLORS,

    /**
     * Get the latest session information
     */
    async getLatestSession() {
      const sessions = await apiRequest('sessions', { session_key: 'latest' });
      if (Array.isArray(sessions) && sessions.length > 0) {
        return sessions[0];
      }
      return null;
    },

    /**
     * Get sessions for a given year
     */
    async getSessions(year = new Date().getFullYear()) {
      return await apiRequest('sessions', { year });
    },

    /**
     * Get list of drivers for a specific session
     */
    async getDrivers(sessionKey) {
      const drivers = await apiRequest('drivers', { session_key: sessionKey });
      if (!Array.isArray(drivers)) return [];

      return drivers.map(d => {
        let color = d.team_colour ? `#${d.team_colour.replace('#', '')}` : (TEAM_COLORS[d.team_name] || '#FFFFFF');
        return {
          number: d.driver_number,
          code: d.name_acronym || (d.broadcast_name ? d.broadcast_name.substring(0, 3) : `#${d.driver_number}`),
          name: d.full_name || d.broadcast_name,
          team: d.team_name,
          color: color,
          headshot: d.headshot_url
        };
      }).sort((a, b) => a.number - b.number);
    },

    /**
     * Get telemetry car data for a driver in a specific time window
     */
    async getCarData(sessionKey, driverNumber, dateStart, dateEnd) {
      const params = {
        session_key: sessionKey,
        driver_number: driverNumber
      };
      if (dateStart) params['date>='] = dateStart;
      if (dateEnd) params['date<='] = dateEnd;

      return await apiRequest('car_data', params);
    },

    /**
     * Get car data around the playback point (now - offset), so large
     * stream-delay offsets still have samples to interpolate.
     */
    async getCarWindow(sessionKey, driverNumber, offsetSec = 0, beforeSec = 10, afterSec = 5) {
      const center = Date.now() - Math.max(0, offsetSec) * 1000;
      return await apiRequest('car_data', {
        session_key: sessionKey,
        driver_number: driverNumber,
        'date>=': new Date(center - beforeSec * 1000).toISOString(),
        'date<=': new Date(center + afterSec * 1000).toISOString()
      });
    },

    /**
     * Get recent car data points (used for polling live session)
     */
    async getRecentCarData(sessionKey, driverNumber, secondsBack = 15) {
      // If we don't have absolute live time, we can query latest
      const now = new Date();
      const past = new Date(now.getTime() - secondsBack * 1000);
      return await apiRequest('car_data', {
        session_key: sessionKey,
        driver_number: driverNumber,
        'date>=': past.toISOString()
      });
    },

    /**
     * Get real-time GPS track coordinate locations for a driver
     */
    async getRecentLocation(sessionKey, driverNumber, secondsBack = 12) {
      const now = new Date();
      const past = new Date(now.getTime() - secondsBack * 1000);
      return await apiRequest('location', {
        session_key: sessionKey,
        driver_number: driverNumber,
        'date>=': past.toISOString()
      });
    },

    /**
     * Get all sessions for a specific Grand Prix weekend meeting
     */
    async getMeetingSessions(meetingKey) {
      return await apiRequest('sessions', { meeting_key: meetingKey });
    },

    /**
     * Get current status, next upcoming event, and weekend schedule
     */
    async getWeekendEventSchedule() {
      const latest = await this.getLatestSession();
      if (!latest) return null;

      let allSessions = [];
      try {
        allSessions = await this.getMeetingSessions(latest.meeting_key);
        allSessions.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
      } catch (e) {
        allSessions = [latest];
      }

      const now = new Date();

      // Check if a session is LIVE right now
      const liveSession = allSessions.find(s => {
        const start = new Date(s.date_start);
        const end = new Date(s.date_end);
        return now >= start && now <= end;
      });

      if (liveSession) {
        return {
          status: 'LIVE',
          activeSession: liveSession,
          sessions: allSessions,
          circuit: liveSession.circuit_short_name || liveSession.country_name,
          country: liveSession.country_name
        };
      }

      // Find the next upcoming session
      const upcomingSession = allSessions.find(s => new Date(s.date_start) > now);

      if (upcomingSession) {
        return {
          status: 'UPCOMING',
          activeSession: upcomingSession,
          sessions: allSessions,
          circuit: upcomingSession.circuit_short_name || upcomingSession.country_name,
          country: upcomingSession.country_name
        };
      }

      // If all completed, return latest completed
      return {
        status: 'COMPLETED',
        activeSession: latest,
        sessions: allSessions,
        circuit: latest.circuit_short_name || latest.country_name,
        country: latest.country_name
      };
    }
  };
})();
