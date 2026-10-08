# Animo 🐈

Windows와 macOS 화면 위에서 산책하거나, 사용자가 놓아 둔 자리에서 쉬는 작은 고양이입니다.
Electron + TypeScript + SVG를 사용하며 외부 서버나 AI API 없이 동작합니다.
몸에서 이어지는 다리와 네 발의 순차 보행, 앉기·잠자기·잡힌 자세를 공통으로 렌더링합니다.

## Windows 실행

`Start-Animo.cmd` 또는 `release/Animo-win32-x64/Animo.exe`를 실행합니다.
배포 폴더에는 Electron 런타임이 포함되어 있어 Node.js와 .NET을 따로 설치할 필요가 없습니다.
다른 PC에는 `release/Animo-win32-x64` **폴더 전체**를 복사하세요.

## Mac 실행

- **Apple Silicon (M1/M2/M3 등):** `release/Animo-darwin-arm64.zip`
- **Intel Mac:** `release/Animo-darwin-x64.zip`

Windows에서 생성한 압축 파일을 Mac의 기본 압축 해제 도구로 풀고, `Animo.app`과 같은 폴더의 `Open-Animo.command`를 실행합니다.
이 명령은 해당 앱에 로컬 테스트용 임시 서명을 적용하고 앱을 엽니다. 이후에는 `Animo.app`을 직접 실행할 수 있습니다.
Node.js와 .NET 설치는 필요하지 않습니다.

현재 Mac 압축 파일은 **실기기 미검증·미공증 개발 빌드**입니다. Windows 호스트에서 패키지 구조, 심볼릭 링크, 실행 권한, Info.plist와 앱 코드 포함 여부를 확인했습니다.
macOS 보안 설정에서 사용자 승인이 필요할 수 있습니다. 일반 사용자에게 정식 배포하려면 Mac에서 Developer ID 서명과 Apple 공증을 진행해야 합니다.

Mac에서 직접 빌드하면 Electron Packager로 `release/Animo-darwin-arm64/Animo.app`과 `release/Animo-darwin-x64/Animo.app`을 생성합니다.
실제 표시·입력 동작 검증은 아직 Mac에서 수행하지 않았습니다.

## 사용

- **끌어서 배치:** 고양이를 왼쪽 마우스로 끌어 놓으면 산책을 멈추고 그 자리에 머뭅니다.
- **산책 재개:** 고양이 우클릭 메뉴 또는 트레이/메뉴 막대 아이콘에서 `산책 모드`를 선택합니다.
- **산책 범위:** 기본은 화면 아래쪽입니다. `화면 아래쪽에서만 산책`을 해제하면 화면 전체에서 움직입니다.
- **클릭 통과:** 빈 투명 영역에서는 뒤쪽 프로그램을 클릭할 수 있습니다. `고양이도 클릭 통과`를 켜면 고양이 위에서도 클릭이 통과합니다.
- **고양이 찾기:** 아이콘 메뉴의 `고양이 찾기` 또는 단축키로 클릭 통과를 해제하고 주 화면 아래쪽으로 복귀합니다.
- **크기·모니터 변경:** 메뉴에서 선택합니다. 다른 모니터로 드래그해서 옮길 수도 있습니다.
- **숨기기·멈추기·종료:** 메뉴에서 선택합니다. 숨기기와 일시 정지는 다음 실행까지 저장하지 않습니다.
- **Mac 데스크톱:** `모든 데스크톱에서 표시`로 Spaces 표시 범위를 바꿉니다. 전체 화면 공간 위 표시도 요청하지만, 실기기 검증이 필요합니다.

| 동작 | Windows | Mac |
|---|---|---|
| 숨기기 / 보이기 | Ctrl+Alt+C | Command+Option+C |
| 고양이 찾기 | Ctrl+Alt+R | Command+Option+R |

다른 앱이 단축키를 사용 중이라면 아이콘 메뉴를 사용하세요.
일반적인 오버레이 기능에 화면 녹화나 접근성 권한을 요청하지 않습니다.

## 설정

위치·크기·산책 범위·클릭 통과·Mac 데스크톱 표시 옵션을 종료 시점과 15초마다 저장합니다.

- Windows: `%APPDATA%/Animo/settings.json`
- Mac: `~/Library/Application Support/Animo/settings.json`

모니터 식별자와 작업 영역 내부의 상대 좌표를 저장합니다. 모니터를 분리하면 남은 화면 안으로 위치를 복구합니다.
Windows 첫 실행에서는 이전 WPF 버전의 `%LOCALAPPDATA%/Animo/settings.json`을 가져옵니다. 기존 파일은 덮어쓰지 않습니다.
다중 모니터 좌표는 Electron의 DIP로 통일하며, 메뉴를 열 때는 화면 좌표를 창 내부 좌표로 변환합니다.

## 개발·빌드

Node.js 22.12 이상 또는 24 이상이 필요합니다. Windows에서 Mac 압축 파일을 만들 때에는 Python 3도 필요합니다.

```sh
npm ci
npm start
npm run verify
npm run package:win
npm run package:mac
```

환경에서 npm 설치 스크립트를 차단했다면 `node node_modules/electron/install.js`로 Electron 런타임을 설치하세요.
Windows에서는 `./Build.ps1 -Verify -Target both`로 검증과 두 플랫폼 패키지를 만들 수도 있습니다.

`npm test`는 산책 경계·자리 고정·보행 발 접지·모니터 좌표·설정 복구와 WPF 설정 이전을 검증합니다.
`npm run verify`는 실제 Electron 창에서 preload IPC, 투명 영역, 모든 연결 모니터에서 배치·크기·네이티브 메뉴·상태 전환·렌더링을 추가 검증합니다.
결과와 PNG는 `artifacts/electron-verification`에 저장됩니다. 실제 마우스 클릭 통과·드래그와 Mac Spaces/Retina 입력 동작은 수동 검증 항목입니다.

## 코드

- `src/main.ts`: 투명 창, 트레이/메뉴 막대, 입력, 모니터, 단축키
- `src/renderer.ts`, `src/cat.ts`: SVG 고양이와 입력 영역
- `src/shared`: 산책, 보행, 좌표 변환, 공유 타입
- `src/settings.ts`: 설정 저장과 이전 Windows 설정 가져오기
- `scripts/package.mjs`: 플랫폼 패키징
- `scripts/mac-archive.py`: Windows에서 Mac 심볼릭 링크를 보존해 압축하는 보조 도구

기존 C# 소스와 `Animo.csproj`는 이전 Windows WPF 구현입니다. `Build-Wpf.ps1`로 별도 빌드할 수 있으며, 기본 실행과 배포는 Electron 버전을 사용합니다.
