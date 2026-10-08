# Electron 유지 시 패키지 용량 절감

2026-10-08에 Animo 0.4.0, 커밋 `bc31364`, Electron 44.7.0, Windows x64 패키지로 측정했습니다. 한국어·영어만 남긴 패키지를 기준으로 추가 압축을 비교했습니다.

Electron을 유지하면서 **다운로드 파일과 Windows 디스크 사용량을 더 줄일 수 있습니다.** 파일을 제거하는 방식이 아니라 배포 압축 형식을 바꾸거나 Windows의 실행 파일 압축을 사용하는 방법입니다. 현재 자동 배포는 기존 ZIP 형식을 유지하며, 이번 비교용 파일은 로컬 `artifacts/compact/release`에 생성했습니다.

## 실측 결과

MB는 1,000,000바이트 기준입니다. ZIP과 TAR.XZ는 다운로드 파일 크기이며, LZX는 압축 해제한 실행 폴더의 저장 바이트 수입니다. 두 종류의 수치를 서로 구분해야 합니다.

| 대상 | 방식 | 바이트 | 약 MB | 비교 기준 대비 절감 |
|---|---|---:|---:|---:|
| 다운로드 | 기존 ZIP | 146,035,924 | 146.04 | 기준 |
| 다운로드 | ZIP DEFLATE 최대 압축, 레벨 9 | 145,519,474 | 145.52 | 0.52MB / 0.35% |
| 다운로드 | TAR.XZ, LZMA2 preset 6 | 106,931,544 | 106.93 | 39.10MB / 26.78% |
| 실행 폴더 | 파일 내용 크기 합계 | 336,926,761 | 336.93 | 기준 |
| 실행 폴더 | Windows LZX 압축 후 저장 바이트 합계 | 143,971,692 | 143.97 | 192.96MB / 57.27% |

LZX 적용 후에도 파일 내용 크기 합계는 336.93MB입니다. 파일을 읽을 때 Windows가 압축을 해제하므로 앱은 평소처럼 실행합니다. 이 수치는 `compact.exe` 보고와 파일별 `GetCompressedFileSizeW` 합계를 확인한 값이며, 폴더 메타데이터 등 볼륨 전체 부가 사용량을 측정한 값은 아닙니다.

앞서 언어 파일 정리로 Windows 실행 폴더는 약 385.68MB에서 336.93MB로 줄었습니다. 앱 코드·화면·고양이 리소스를 담은 `app.asar`는 약 0.28MB이며, `Animo.exe`는 약 246.30MB입니다. 앱 코드를 더 줄여도 전체 패키지에 미치는 효과는 작습니다.

## 검증

- LZX 적용 전후 모든 22개 파일의 SHA-256이 동일했습니다.
- LZX 적용 후 패키지 실행, 분리된 preload, 투명 창, 숨김·복귀 후 드래그, 첫 버튼 누름 누락 복구, 다른 앱에서 들어오는 드래그 무시, 고양이 7개 자세 렌더링, 설정 창·위치 IPC 검증이 통과했습니다.
- 최대 압축 ZIP의 전체 CRC 검사를 통과했습니다.
- TAR.XZ의 전체 스트림을 읽고 22개 파일의 목록과 SHA-256을 실행 검증한 원본 패키지와 비교했습니다. 모두 일치했습니다.

이번 추가 압축 검사는 Windows 패키지 대상입니다. Mac 언어 파일 정리 빌드는 앞서 ZIP 구조·심볼릭 링크·실행 권한을 확인했지만, 이번 LZMA2 비교에 Mac 앱은 포함하지 않았습니다. Windows LZX 방식은 Mac에 적용되지 않습니다. 장시간 CPU·배터리·시작 시간의 변화도 아직 측정하지 않았습니다.

## Windows에서 실행 폴더 압축하기

Windows 10/11의 NTFS 드라이브에서 사용할 수 있습니다. Animo를 종료한 뒤 현재 소스로 패키지를 만들고 실행 파일 압축을 적용합니다. 다음 명령은 Animo 패키지 폴더에만 적용하며 운영체제 전체 압축 설정을 변경하지 않습니다.

```powershell
npm run package:win
$animoFolder = (Resolve-Path 'release/Animo-win32-x64').Path
compact.exe /c /a /exe:lzx "/s:$animoFolder" /q
node scripts/verify-package.mjs
```

압축 후에도 `Animo.exe`를 바로 실행하면 됩니다. Explorer의 파일 내용 크기는 계속 약 337MB로 보일 수 있습니다. 다른 폴더나 PC로 옮긴 뒤에는 압축 상태를 확인하고 필요하면 다시 적용합니다. ZIP에 이 디스크 압축 상태가 저장되는 것은 아닙니다.

되돌리려면 같은 패키지 폴더에 다음 명령을 실행합니다.

```powershell
$animoFolder = (Resolve-Path 'release/Animo-win32-x64').Path
compact.exe /u /a /exe:lzx "/s:$animoFolder" /q
```

Microsoft는 `/EXE`를 자주 읽고 수정은 적은 실행 파일을 위한 압축으로 설명하며, LZX를 가장 작은 방식으로 제공합니다. 파일을 읽을 때 압축 해제 처리가 추가되므로 성능 영향은 별도 측정해야 합니다. [Microsoft compact 문서](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/compact)

## 다운로드 압축 재현

Python 3 표준 라이브러리로 비교했습니다. 다음 명령은 패키지 폴더를 변경하지 않고 최대 압축 ZIP과 TAR.XZ를 생성합니다. 기본 출력 폴더가 아니라 별도 패키지를 비교하려면 `animo_folder`를 바꿉니다.

```powershell
@'
import pathlib, tarfile, zipfile
animo_folder = pathlib.Path('release/Animo-win32-x64')
with zipfile.ZipFile(animo_folder.parent / 'Animo-max.zip', 'w',
                     zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for item in sorted(animo_folder.rglob('*')):
        if item.is_file():
            archive.write(item, item.relative_to(animo_folder.parent).as_posix())
with tarfile.open(animo_folder.parent / 'Animo.tar.xz', 'w:xz', preset=6) as archive:
    archive.add(animo_folder, arcname=animo_folder.name)
'@ | python -
```

LZMA2 비교는 TAR.XZ로 직접 측정한 결과입니다. 같은 계열의 압축을 사용하는 7z 파일의 정확한 용량을 측정한 결과는 아닙니다. [7-Zip LZMA/LZMA2 설명](https://www.7-zip.org/sdk.html)

## 적용 방향

개인 Windows 사용에서 저장 공간을 줄이려면 **LZX 디스크 압축**이 현재 검증한 방법 중 효과가 큽니다. ZIP 호환성과 기존 자동 배포를 유지할 수 있습니다. 다운로드 파일을 더 줄여야 한다면 TAR.XZ나 7z를 추가하는 방향을 검토할 수 있으며, 추출 도구와 Mac의 링크·권한 보존까지 검증한 후 배포 워크플로에 반영해야 합니다.

현재 실행 엔진 파일에는 그래픽 처리와 대체 렌더링에 쓰이는 구성 요소가 포함되어 있습니다. DLL을 임의로 제외하면 다른 GPU나 모니터 환경에서 동작이 달라질 수 있으므로 이번 절감에는 포함하지 않았습니다. 라이선스 고지도 유지했습니다.

Electron 자체를 직접 빌드해 필요한 기능만 포함하는 방향도 가능하지만, 절감 폭은 아직 확인하지 않았습니다. Chromium·Node.js를 포함한 엔진 빌드와 업데이트 유지가 필요하므로 개인용 Animo에서는 우선순위가 낮습니다. [Electron 자체 빌드 안내](https://www.electronjs.org/docs/latest/development/build-instructions-gn)
