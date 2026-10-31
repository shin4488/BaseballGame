import Vector2 from '../vector/vector2';
import { FirebaseAuthExtention } from '../firebase/auth';
import { FireStoreExtention, FireStoreColumn } from '../firebase/database';
import {
  isBallHitDuringSwing,
  getBoardHitTime,
  getResultMessage,
  getRandomNumber,
} from './process';
import { boardItems, guestImagePath } from './appConfig';
import 'regenerator-runtime/runtime.js';

export const createVueInstance = () => {
  let guestCreation = null;
  // 前回のバットとの当たり判定の時点の角度と、その後に描いたバットの角度を、描き始めた時刻とともに描いた順に並べる。判定と判定の間に通った角度をたどるために使う。
  let batFrames = [];
  return new Vue({
    el: '#app',
    computed: {
      moundStyleComputed() {
        return `width: ${this.moundSize}px; height: ${this.moundSize}px;
          top: ${this.moundYPositionComputed}px;`;
      },
      ballStyleComputed() {
        return `width: ${this.ballSize}px; height: ${this.ballSize}px;
          top: ${this.ballYPositionComputed}px;
          transform: translate(${this.xBallPosition}px, ${this.yBallPosition}px);`;
      },
      batStyleComputed() {
        return `width: ${this.batInitWidth}px; height: ${this.batInitHeight}px;
          left: ${this.batXPositionComputed}px; top: ${this.batYPositionComputed}px;
          transform: rotate(${this.batRotateDegree}deg);
          transform-origin: ${this.batInitWidth}px 0;`;
      },
      hitButtonStyleComputed() {
        return `top: ${this.hitButtonYPositionComputed}px;`;
      },
      boardItemStyleComputed() {
        return `height: ${this.ballSize}px;`;
      },
      moundYPositionComputed() {
        return this.viewportHeight / 5;
      },
      /** ボールの初期Y座標 */
      ballYPositionComputed() {
        // 「マウンドの中心」にボールのtopが来るように調整
        return this.moundYPositionComputed + this.moundSize / 2;
      },
      /** バットの初期X座標 */
      batXPositionComputed() {
        return -this.batInitHeight * 1.2;
      },
      /** バットの初期Y座標 */
      batYPositionComputed() {
        return this.viewportHeight - this.batInitHeight * 1.5;
      },
      hitButtonYPositionComputed() {
        return this.batYPositionComputed + this.batInitHeight;
      },
      ballRadiusComputed() {
        return this.ballSize / 2;
      },
      isBlankMessage() {
        return this.message === '';
      },
      /** 表示幅に収まる的の数。150は的（.point-item）の幅 */
      boardItemCounterComputed() {
        return Math.max(2, Math.min(4, Math.floor(this.viewportWidth / 150)));
      },
      isTwoStrikeComputed() {
        return this.strikeCount === 2;
      },
      playerNameComputed() {
        if (this.loginUserName !== null)
          return this.loginUserName || 'プレイヤー';
        if (this.guestNumber !== null) return `ゲスト${this.guestNumber}`;
        return this.isPreparingGuest ? '番号を取得中…' : 'ゲスト';
      },
      userMessageComputed() {
        return `こんにちは ${this.playerNameComputed} さん`;
      },
      /** 得点は結果画面で独立して表示する */
      resultHeadlineComputed() {
        return this.resultMessage.replace(/ \d+ 得点$/, '');
      },
      userStartButtonTextComputed() {
        return this.loginUserName === null
          ? 'ログインして開始'
          : `${this.loginUserName}として開始`;
      },
      isSelectingModeShownComputed() {
        return !(this.shouldShowInitImage || this.shouldShowResult);
      },
    },
    data: {
      isPreparingGuest: false,
      viewportWidth: window.document.documentElement.clientWidth,
      viewportHeight: window.document.documentElement.clientHeight,
      rankingsRequestId: 0,
      isStartingGame: false,
      startError: '',
      guestNumber: null,
      guestUserId: null,
      rankings: {
        thisWeek: {
          titleText: '今週の得点ランキング',
          headerTexts: {},
          dataList: [],
          isLoading: true,
          error: '',
        },
        history: {
          titleText: '歴代の得点ランキング',
          headerTexts: {},
          dataList: [],
          isLoading: true,
          error: '',
        },
      },
      headerTexts: {
        rankingText: '順位',
        playerText: 'プレイヤー',
        pointText: '得点',
        playDateText: 'プレイ日',
      },
      resultShowingButtonTexts: {
        saveResultText: '結果を上書き保存',
        retryText: '保存せずにリトライ',
        finishWithoutSaveText: '保存せずに終了',
      },
      guestButtonText: 'ゲストとして開始',
      changeAccountButtonText: 'アカウントを切り替えて開始',
      loginUserName: null,
      batSwingButtonText: '打つ',
      pointUnitText: '点',
      message: '',
      resultMessage: '',
      boardItems: [],
      // width/height
      moundSize: 100,
      ballSize: 40,
      batInitWidth: 20,
      batInitHeight: 120,
      // transform
      xBallPosition: 0,
      yBallPosition: 0,
      batRotateDegree: 0,
      ratRotateDegreeSpeed: 10,
      maxBatRotateDegree: -100,
      // interval
      ballMovingInterval: 30,
      batSwingInterval: 10,
      reThrowInterval: 4000,
      messageShowingInterval: 1500,
      // speed
      minBallSpeed: 10,
      maxBallSpeed: 30,
      maxXBallPosition: 30,
      // count
      outCount: 0,
      point: 0,
      strikeCount: 0,
      // flag
      shouldShowInitImage: true,
      isGameOpened: false,
      shouldShowResult: false,
      isSavingResult: false,
    },
    mounted() {
      window.addEventListener('resize', this.updateViewport);
      this.loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
      this.shouldShowInitImage = false;
      this.initializeTopMenuData();
      this.setBoardItems();
      if (this.loginUserName === null) {
        this.createGuestUser().catch(() => {
          if (this.loginUserName === null) {
            this.startError =
              'ゲスト番号を取得できませんでした。「ゲストとして開始」で再試行できます。';
          }
        });
      }
    },
    beforeDestroy() {
      window.removeEventListener('resize', this.updateViewport);
    },
    watch: {
      message() {
        // 1球ごとの試合中のメッセージは投球前に消す
        if (!this.isBlankMessage) {
          setTimeout(() => {
            this.message = '';
          }, this.messageShowingInterval);
        }
      },
    },
    methods: {
      updateViewport() {
        this.viewportWidth = window.document.documentElement.clientWidth;
        this.viewportHeight = window.document.documentElement.clientHeight;
        // 既存の的を保ちながら、画面幅に合う個数に調整する。
        this.boardItems = this.boardItems.slice(
          0,
          this.boardItemCounterComputed,
        );
        while (this.boardItems.length < this.boardItemCounterComputed) {
          this.boardItems.push(
            boardItems[Math.floor(Math.random() * boardItems.length)],
          );
        }
      },
      async onClickGuestStart() {
        if (this.isStartingGame) return;
        this.isStartingGame = true;
        this.startError = '';
        try {
          await FirebaseAuthExtention.auth.signOutFromGoogle();
          this.loginUserName = null;
          if (this.guestUserId === null) {
            await this.createGuestUser();
          }
          this.executeBaseballGame();
        } catch {
          this.startError =
            '開始できませんでした。通信状態を確認して、もう一度お試しください。';
        } finally {
          this.isStartingGame = false;
        }
      },
      async onClickLogin() {
        if (this.isStartingGame) return;
        if (!FirebaseAuthExtention.auth.isLoggedIn()) {
          try {
            await FirebaseAuthExtention.auth.signInWithPopupToGoogle();
          } catch {
            // ログインせずにログイン画面を閉じた際は処理終了
            return;
          }
        }

        this.loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
        this.executeBaseballGame();
      },
      async onClickChangeAccount() {
        if (this.isStartingGame) return;
        try {
          await FirebaseAuthExtention.auth.signInWithPopupToGoogle();
        } catch {
          // ログインせずにログイン画面を閉じた際は処理終了
          return;
        }

        this.loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
        this.executeBaseballGame();
      },
      async onClickRecordDeleteButton(recordItem) {
        const shouldDelete = window.confirm(
          `記録を削除しますか。\n得点：${recordItem.point}\nプレイ日：${recordItem.playDate}`,
        );
        if (shouldDelete) {
          await FireStoreExtention.loginUserStore.deleteRanking(
            recordItem.playerId,
          );
          this.initializeTopMenuData();
        }
      },
      onClickHit() {
        // 徐々にバットを振る
        this.batRotateDegree = -this.ratRotateDegreeSpeed;
        batFrames.push({ time: Date.now(), degree: this.batRotateDegree });
        const swingProcess = setInterval(() => {
          this.batRotateDegree -= this.ratRotateDegreeSpeed;
          // 同じ処理の中で0度に戻すため、maxBatRotateDegreeの角度は画面に描かれない。
          if (this.batRotateDegree <= this.maxBatRotateDegree) {
            this.batRotateDegree = 0;
            clearInterval(swingProcess);
          }
          batFrames.push({ time: Date.now(), degree: this.batRotateDegree });
        }, this.batSwingInterval);
      },
      async onClickSaveButton() {
        if (this.isSavingResult) return;
        this.isSavingResult = true;
        const isLoggedIn = FirebaseAuthExtention.auth.isLoggedIn();
        const loginUserId = FirebaseAuthExtention.auth.getLoginUserId();
        const loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
        const loginUserIconImage =
          FirebaseAuthExtention.auth.getLoginUserIconImage();

        const parameter = {
          documentId: isLoggedIn ? loginUserId : this.guestUserId,
          userName: isLoggedIn ? loginUserName : `ゲスト${this.guestNumber}`,
          userIconImageUrl: isLoggedIn ? loginUserIconImage : guestImagePath,
          point: this.point,
        };
        try {
          const store = isLoggedIn
            ? FireStoreExtention.loginUserStore
            : FireStoreExtention.guestStore;
          await store.upsertRanking(parameter);
        } catch {
          window.alert(
            '保存できませんでした。通信状態を確認して、もう一度お試しください。',
          );
          return;
        } finally {
          this.isSavingResult = false;
        }

        this.shouldShowResult = false;
        await this.initializeTopMenuData();
      },
      onClickRetryButton() {
        if (this.isSavingResult) return;
        this.shouldShowResult = false;
        this.executeBaseballGame();
      },
      onClickFinishButton() {
        if (this.isSavingResult) return;
        this.shouldShowResult = false;
        this.initializeTopMenuData();
      },

      async initializeTopMenuData() {
        // ランキングの取得が重なったときに、先に始めた取得の応答が後から届いても、新しい結果を上書きしない。
        const requestId = ++this.rankingsRequestId;
        const sources = [
          ['history', () => FireStoreExtention.getRankingHistory()],
          ['thisWeek', () => FireStoreExtention.getRankingThisWeek()],
        ];
        await Promise.all(
          sources.map(async ([key, fetchRanking]) => {
            const ranking = this.rankings[key];
            ranking.headerTexts = this.headerTexts;
            ranking.isLoading = true;
            ranking.error = '';
            try {
              const rows = await fetchRanking();
              const data = await this.mapFirestoreToRankingTable(rows);
              if (requestId === this.rankingsRequestId) ranking.dataList = data;
            } catch {
              if (requestId === this.rankingsRequestId) {
                ranking.error = 'ランキングを取得できませんでした。';
              }
            } finally {
              if (requestId === this.rankingsRequestId)
                ranking.isLoading = false;
            }
          }),
        );
      },
      async mapFirestoreToRankingTable(firestoreDataList) {
        const loginUser = await FirebaseAuthExtention.auth.getLoginUserId();
        return firestoreDataList.map((x) => {
          const rankingUserId = x[FireStoreColumn.userId];
          const lastPlayDate = x[FireStoreColumn.lastUpdated].toDate();
          return {
            playerIconImage: x[FireStoreColumn.userIconImageUrl],
            playerName: x[FireStoreColumn.userName],
            playerId: rankingUserId,
            point: x[FireStoreColumn.point],
            playDate: `${lastPlayDate.getFullYear()}/${
              lastPlayDate.getMonth() + 1
            }/${lastPlayDate.getDate()}`,
            isLoginUser: rankingUserId === loginUser,
          };
        });
      },
      async createGuestUser() {
        if (this.guestUserId !== null) return;
        // 初回表示と開始ボタンが重なっても、同じ発番を待つ。
        if (guestCreation === null) {
          this.isPreparingGuest = true;
          guestCreation = (async () => {
            const { guestNumberWithPadding, randomString } =
              await FireStoreExtention.guestStore.createUserId();
            this.guestNumber = Number(guestNumberWithPadding);
            this.guestUserId = `${guestNumberWithPadding}${randomString}`;
          })().finally(() => {
            this.isPreparingGuest = false;
            guestCreation = null;
          });
        }
        await guestCreation;
      },
      executeBaseballGame() {
        if (this.isGameOpened) return;
        this.clearBaseballGame();

        this.message = 'プレイボール！';
        this.isGameOpened = true;

        // 前の投球が完了するまで、次の投球を予約しない。
        const pitchNext = async () => {
          const startedAt = Date.now();
          await this.throwBall();

          this.clearThrowingBall();

          if (this.outCount >= 3) {
            // 3アウトの直後に結果画面へ切り替えると唐突なため、ゲーム画面のまま「ゲームセット」を表示してから結果画面に移る。
            setTimeout(() => {
              this.resultMessage = getResultMessage(this.point);
              this.message = 'ゲームセット';
              setTimeout(() => {
                this.shouldShowResult = true;
                this.isGameOpened = false;
              }, this.messageShowingInterval);
            }, this.messageShowingInterval);
            return;
          }
          // 通常の投球間隔を保ち、長い打球でも結果表示を省略しない。
          setTimeout(
            pitchNext,
            Math.max(
              this.reThrowInterval - (Date.now() - startedAt),
              this.messageShowingInterval,
            ),
          );
        };
        setTimeout(pitchNext, this.reThrowInterval);
      },
      setBoardItems() {
        this.boardItems = [];
        for (
          let countPointItem = 0;
          countPointItem < this.boardItemCounterComputed;
          countPointItem++
        ) {
          const targetIndex = Math.floor(Math.random() * boardItems.length);
          this.boardItems.push(boardItems[targetIndex]);
        }
      },
      clearThrowingBall() {
        this.yBallPosition = 0;
        this.xBallPosition = 0;
        this.setBoardItems();
      },
      clearBaseballGame() {
        this.point = 0;
        this.outCount = 0;
        this.strikeCount = 0;
      },
      /**
       * ボールを1球投げ、得点・アウト・ストライク・ファールのいずれかが決まるか、ボールの座標を取得できなかった時点で完了する。
       */
      async throwBall() {
        const boardList = window.document.getElementsByClassName('point-item');

        let yBallIncrement = getRandomNumber(
          this.minBallSpeed,
          this.maxBallSpeed,
        );
        let xBallIncrement = 0;
        let previousBallCenter = null;
        batFrames = [{ time: Date.now(), degree: this.batRotateDegree }];

        await new window.Promise((resolve) => {
          const ballMoveProcess = setInterval(() => {
            const bat = window.document.getElementById('bat');
            // offsetLeft・offsetTopは回転前の配置で、文書の左上からの位置。ゲーム画面はスクロールしないため、getBoundingClientRectで求めるボールの座標と比べられる。
            const batShape = {
              pivot: new Vector2(
                bat.offsetLeft + this.batInitWidth,
                bat.offsetTop,
              ),
              width: this.batInitWidth,
              length: this.batInitHeight,
            };
            const currentBatFrame = {
              time: Date.now(),
              degree: this.batRotateDegree,
            };
            const swingFrames = [...batFrames, currentBatFrame];
            batFrames = [currentBatFrame];
            const ball = window.document.getElementById('ball');
            const ballPosition = ball.getBoundingClientRect();
            const ballCenterVec2 = new Vector2(
              ballPosition.left + this.ballRadiusComputed,
              ballPosition.top + this.ballRadiusComputed,
            );
            // バットに当たったらボールを跳ね返す。
            // 2度打ちにならないよう、跳ね返った後のボールはバットとの当たり判定をしない。
            const isHitToBat =
              yBallIncrement >= 0 &&
              isBallHitDuringSwing(
                batShape,
                swingFrames,
                previousBallCenter ?? ballCenterVec2,
                ballCenterVec2,
                this.ballRadiusComputed,
              );
            if (isHitToBat) {
              yBallIncrement = -yBallIncrement;
              xBallIncrement = getRandomNumber(
                -this.maxXBallPosition,
                this.maxXBallPosition,
              );
              previousBallCenter = ballCenterVec2;
              return;
            }

            // iOSの端末でボールの座標を取得できないことがあるため、座標がすべて0なら投げ直す。
            // TODO: 原因は分かっていないが、このチェックをバットとの当たり判定より前に行うと検知できないエラーが起きるため、当たり判定の後に行っている。
            const shouldReThrow =
              ballPosition.x === 0 &&
              ballPosition.y === 0 &&
              ballPosition.bottom === 0 &&
              ballPosition.height === 0 &&
              ballPosition.left === 0 &&
              ballPosition.right === 0 &&
              ballPosition.top === 0 &&
              ballPosition.width === 0;
            if (shouldReThrow) {
              this.message = 'エラー発生。しばらくお待ちください。';
              clearInterval(ballMoveProcess);
              resolve();
              return;
            }

            // 移動中の軌道を調べ、表示順ではなく最初に触れた的を採用する。
            let hitBoard = null;
            let firstHitTime = Infinity;
            if (yBallIncrement < 0) {
              for (const board of boardList) {
                const hitTime = getBoardHitTime(
                  previousBallCenter,
                  ballCenterVec2,
                  this.ballRadiusComputed,
                  board.getBoundingClientRect(),
                );
                if (hitTime !== null && hitTime < firstHitTime) {
                  hitBoard = board;
                  firstHitTime = hitTime;
                }
              }
            }
            if (hitBoard) {
              this.point += Number(hitBoard.dataset.point);
              this.outCount = Math.min(
                3,
                this.outCount + Number(hitBoard.dataset.out),
              );
              this.strikeCount = 0;
              this.message = hitBoard.dataset.message;
              clearInterval(ballMoveProcess);
              resolve();
              return;
            }

            // フェアゾーンに打ち返して的に当たらなかったときはアウト
            if (ballPosition.top <= 0) {
              this.outCount += 1;
              this.strikeCount = 0;
              this.message = 'アウト';
              clearInterval(ballMoveProcess);
              resolve();
              return;
            }

            // 見逃し/空振り -> ストライク（アウトになり得る）
            const isHitToButton =
              ballPosition.bottom > this.hitButtonYPositionComputed;
            if (isHitToButton) {
              this.message = this.isTwoStrikeComputed ? '三振' : 'ストライク';
              this.outCount = this.isTwoStrikeComputed
                ? this.outCount + 1
                : this.outCount;
              this.strikeCount = this.isTwoStrikeComputed
                ? 0
                : this.strikeCount + 1;
              clearInterval(ballMoveProcess);
              resolve();
              return;
            }

            // ファール -> ストライク（アウトにはならない）
            const isFaul =
              ballPosition.left <= 0 ||
              ballPosition.right >= this.viewportWidth;
            if (isFaul) {
              this.strikeCount = this.isTwoStrikeComputed
                ? 2
                : this.strikeCount + 1;
              this.message = 'ファール';
              clearInterval(ballMoveProcess);
              resolve();
              return;
            }

            previousBallCenter = ballCenterVec2;

            this.yBallPosition += yBallIncrement;
            // ボールが跳ね返っているときは左右にボールを振る
            if (yBallIncrement < 0) {
              this.xBallPosition += xBallIncrement;
            }
          }, this.ballMovingInterval);
        });
      },
    },
  });
};
