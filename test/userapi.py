import json
import requests
from urllib.parse import urljoin

from .apibase import APIBase


class UserAPI(APIBase):
    def __init__(self, baseurl, username, password='password'):
        super().__init__('user', baseurl, username, password)

    def query(self, startDate=None, endDate=None, min_secs=0, limit=100, offset=0, tagmode=None, tags=None):
        url = urljoin(self._baseurl, '/api/v1/recordings')

        where = [{"duration": {"$gte": min_secs}}]
        if startDate is not None:
            where.append({
                'recordingDateTime': {
                    '$gte': startDate.isoformat()
                }
            })
        if endDate is not None:
            where.append({'recordingDateTime': {'$lte': endDate.isoformat()}})

        params = {'where': json.dumps(where)}
        if limit is not None:
            params['limit'] = limit
        if offset is not None:
            params['offset'] = offset
        if tagmode is not None:
            params['tagMode'] = tagmode
        if tags is not None:
            params['tags'] = json.dumps(tags)

        r = requests.get(url, params=params, headers=self._auth_header)
        if r.status_code == 200:
            return r.json()['rows']
        elif r.status_code == 400:
            messages = r.json()['messages']
            raise IOError("request failed ({}): {}".format(
                r.status_code, messages))
        else:
            r.raise_for_status()


    def download_cptv(self, id):
        return self._download_recording(id, 'downloadRawJWT')

    def download_mp4(self, id):
        return self._download_recording(id, 'downloadFileJWT')

    def _download_recording(self, id, jwt_key):
        url = urljoin(self._baseurl, '/api/v1/recordings/{}'.format(id))
        r = requests.get(url, headers=self._auth_header)
        d = self._check_response(r)
        return self._download_signed(d[jwt_key])

    def query_audio(self, startDate=None, endDate=None, min_secs=0, limit=100, offset=0):
        url = urljoin(self._baseurl, '/api/v1/audiorecordings')

        where = [{"duration": {"$gte": min_secs}}]
        if startDate is not None:
            where.append({
                'recordingDateTime': {
                    '$gte': startDate.isoformat()
                }
            })
        if endDate is not None:
            where.append({'recordingDateTime': {'$lte': endDate.isoformat()}})

        params = {}
        if limit is not None:
            params['limit'] = limit
        if offset is not None:
            params['offset'] = offset

        r = requests.get(url, params=params, headers=self._auth_header)
        if r.status_code == 200:
            return r.json()['result']['rows']
        elif r.status_code == 400:
            messages = r.json()['messages']
            raise IOError("request failed ({}): {}".format(
                r.status_code, messages))
        else:
            r.raise_for_status()

    def get_audio(self, recording_id):
        url = urljoin(self._baseurl, '/api/v1/audiorecordings/{}'.format(recording_id))

        r = requests.get(url, headers=self._auth_header)
        return self._check_response(r)

    def delete_audio(self, recording_id):
        url = urljoin(self._baseurl, '/api/v1/audiorecordings/{}'.format(recording_id))
        r = requests.delete(url, headers=self._auth_header)
        return self._check_response(r)

    def download_audio(self, recording_id):
        url = urljoin(self._baseurl, '/api/v1/audiorecordings/{}'.format(recording_id))
        r = requests.get(url, headers=self._auth_header)
        d = self._check_response(r)
        return self._download_signed(d['jwt'])

    def download_recording(self, recording_id):
        url = urljoin(self._baseurl, '/api/v1/recordings/{}'.format(recording_id))
        r = requests.get(url, headers=self._auth_header)
        d = self._check_response(r)
        return self._download_signed(d['downloadRawJWT'])

    def _download_signed(self, token):
        r = requests.get(
            urljoin(self._baseurl, '/api/v1/signedUrl'),
            params={'jwt': token},
            stream=True)
        r.raise_for_status()
        yield from r.iter_content(chunk_size=4096)

    def _get_all(self, url):
        r = requests.get(
            urljoin(self._baseurl, url),
            params={'where': '{}'},
            headers=self._auth_header,
        )
        r.raise_for_status()
        return r.text

    def get_devices_as_string(self):
        return self._get_all('/api/v1/devices')

    def get_groups_as_string(self):
        return self._get_all('/api/v1/groups')

    def create_group(self, groupname):
        url = urljoin(self._baseurl, "/api/v1/groups")
        response = requests.post(url,  headers=self._auth_header, data={'groupname': groupname})
        self._check_response(response)

    def get_user_details(self, username):
        url = urljoin(self._baseurl, "/api/v1/users/{}".format(username))
        response = requests.get(url, headers=self._auth_header)
        return response.json()

    def tag_recording(self, recordingId, tagDictionary):
        url = urljoin(self._baseurl, "/api/v1/tags/")
        tagData = {"tag": json.dumps(tagDictionary), "recordingId": recordingId}
        response = requests.post(url, headers=self._auth_header, data=tagData)
        response.raise_for_status()
