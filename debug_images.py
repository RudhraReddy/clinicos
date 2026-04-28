
import requests
import sys

# Assume running locally on port 5000
API_URL = "http://localhost:5000/api"

def list_patient_images(patient_id):
    try:
        response = requests.get(f"{API_URL}/patients/{patient_id}/images")
        if response.status_code == 200:
            images = response.json()
            print(f"Found {len(images)} images for patient {patient_id}:")
            for img in images:
                print(f"ID: {img['id']}, Tag: {img.get('tag')}, Visit ID: {img.get('visit_id')}, Date: {img.get('timestamp')}")
        else:
            print(f"Failed to fetch images: {response.status_code} - {response.text}")
            
        # Also fetch visits to see history
        v_response = requests.get(f"{API_URL}/visits?patient_id={patient_id}")
        if v_response.status_code == 200:
             visits = v_response.json()
             print(f"\nFound {len(visits)} visits:")
             for v in visits:
                 print(f"ID: {v['visit_id']}, Date: {v['visit_date']}")
        else:
            print("Failed to fetch visits")

    except Exception as e:
        print(f"Error: {e}")


def list_all_patients_with_images():
    try:
        # Get all images
        response = requests.get(f"{API_URL}/patients/images")
        if response.status_code == 200:
            images = response.json()
            patient_counts = {}
            for img in images:
                pid = img.get('patient_id')
                patient_counts[pid] = patient_counts.get(pid, 0) + 1
            
            print("Patients with images:")
            for pid, count in patient_counts.items():
                print(f"Patient ID: {pid}, Image Count: {count}")
                
            return list(patient_counts.keys())
        else:
            print(f"Failed to fetch all images: {response.status_code}")
            return []
    except Exception as e:
        print(f"Error: {e}")
        return []

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Listing all patients with images...")
        pids = list_all_patients_with_images()
        if pids:
            print(f"\nRun 'python3 debug_images.py {pids[0]}' to inspect specific patient.")
    else:
        list_patient_images(sys.argv[1])
