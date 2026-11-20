from pathlib import Path
import xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]/'android/app/src/main/res'
def styles(sdk):
 result={}
 for folder in ['values',*[f'values-v{api}' for api in [27,28,29] if api<=sdk]]:
  for item in ET.parse(root/folder/'styles.xml').getroot().findall('style'):
   result[item.get('name')]={'parent':item.get('parent'),'items':{child.get('name'):child.text for child in item.findall('item')}}
 def resolve(name):
  value=result[name];parent=value['parent'];return {**(resolve(parent) if parent in result else {}),**value['items']}
 return resolve
for sdk in [23,25,26,27,28,29,32,33,36]:
 resolve=styles(sdk);app=resolve('AppTheme.NoActionBar');launch=resolve('AppTheme.NoActionBarLaunch')
 assert ('android:windowLightNavigationBar' in app)==(sdk>=27)
 assert ('android:windowLayoutInDisplayCutoutMode' in app)==(sdk>=28)
 assert ('android:enforceNavigationBarContrast' in app)==(sdk>=29)
 assert ('android:enforceStatusBarContrast' in app)==(sdk>=29)
 assert ('android:windowLayoutInDisplayCutoutMode' in launch)==(sdk>=28)
 assert app['windowActionBar']=='false' and app['windowNoTitle']=='true'
 if sdk<27:assert app['android:navigationBarColor']=='@android:color/black'
 print('PASS versioned theme API',sdk)
