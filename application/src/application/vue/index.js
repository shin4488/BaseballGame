import Vector2 from '../vector/vector2';
import { FirebaseAuthExtention } from '../firebase/auth';
import { FireStoreExtention, FireStoreColumn } from '../firebase/database';
import {
  isHitCircleToLine,
  getBoardHitTime,
  getResultMessage,
  getRandomNumber,
} from './process';
import { boardItems, guestImagePath } from './appConfig';
import 'regenerator-runtime/runtime.js';

export const createVueInstance = () => {
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
        return `border-bottom: ${this.ballSize}px solid;
          line-height: ${this.ballSize}px;`;
      },
      playingResultStyleComputed() {
        return `top: ${this.viewportHeight / 2}px;`;
      },
      /** マウンドの初期Y座標 */
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
      /** 打つボタンの初期Y座標 */
      hitButtonYPositionComputed() {
        return this.batYPositionComputed + this.batInitHeight;
      },
      /** ボール半径 */
      ballRadiusComputed() {
        return this.ballSize / 2;
      },
      isBlankMessage() {
        return this.message === '';
      },
      /** 表示幅に収まる盤の数 */
      boardItemCounterComputed() {
        return Math.max(2, Math.min(4, Math.floor(this.viewportWidth / 150)));
      },
      isTwoStrikeComputed() {
        return this.strikeCount === 2;
      },
      /** ユーザ名表示メッセージ */
      userMessageComputed() {
        const userName =
          this.loginUserName === null
            ? `ゲスト${this.guestNumber}`
            : this.loginUserName;
        return `こんにちは ${userName} さん`;
      },
      /** 得点は結果画面で独立して表示する */
      resultHeadlineComputed() {
        return this.resultMessage.replace(/ \d+ 得点$/, '');
      },
      /** ログインユーザでスタートボタンの表示テキスト */
      userStartButtonTextComputed() {
        return this.loginUserName === null
          ? 'ログインして開始'
          : `${this.loginUserName}として開始`;
      },
      // 画面側で使用しており、asyncとすると表示が上手くいかないため同期メソッドとしている
      isSelectingModeShownComputed() {
        return !(this.shouldShowInitImage || this.shouldShowResult);
      },
    },
    data: {
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
          themeColor: 'primary',
          headerTexts: {},
          dataList: [],
          isLoading: true,
          error: '',
        },
        history: {
          titleText: '歴代の得点ランキング',
          themeColor: 'success',
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
      rankingThisWeekText: '今週の得点ランキング',
      rankingAllPeriodText: '歴代の得点ランキング',
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
      /**
       * ゲストでスタートボタン押下処理
       */
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
      /**
       * ログインしてスタートボタン押下処理
       */
      async onClickLogin() {
        if (this.isStartingGame) return;
        // 未ログイン時のみfirebaseログイン処理
        if (!FirebaseAuthExtention.auth.isLoggedIn()) {
          try {
            await FirebaseAuthExtention.auth.signInWithPopupToGoogle();
          } catch {
            // ログインせずにログイン画面を閉じた際は処理終了
            return;
          }
        }

        // TODO:ゲストユーザでプレイしない場合は画面表示時に作成したゲストユーザを削除
        this.guestNumber = null;
        this.guestUserId = null;
        this.loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
        this.executeBaseballGame();
      },
      /**
       * アカウントを切り替えてスタートボタン押下処理
       */
      async onClickChangeAccount() {
        if (this.isStartingGame) return;
        try {
          await FirebaseAuthExtention.auth.signInWithPopupToGoogle();
        } catch {
          // ログインせずにログイン画面を閉じた際は処理終了
          return;
        }

        // TODO:ゲストユーザでプレイしない場合は画面表示時に作成したゲストユーザを削除
        this.guestNumber = null;
        this.guestUserId = null;
        this.loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
        this.executeBaseballGame();
      },
      /**
       * トップ画面で削除ボタン押下処理
       * @param {*} recordItem
       */
      async onClickRecordDeleteButton(recordItem) {
        const shouldDelete = window.confirm(
          `記録を削除しますか。\n得点：${recordItem.point}\nプレイ日：${recordItem.playDate}`,
        );
        if (shouldDelete) {
          await FireStoreExtention.loginUserStore.deleteRanking(
            recordItem.playerId,
          );
          // ランキング再検索
          this.initializeTopMenuData();
        }
      },
      /**
       * 打つボタン押下処理
       */
      onClickHit() {
        // 徐々にバットを振る
        this.batRotateDegree = -this.ratRotateDegreeSpeed;
        const swingProcess = setInterval(() => {
          this.batRotateDegree -= this.ratRotateDegreeSpeed;
          if (this.batRotateDegree <= this.maxBatRotateDegree) {
            this.batRotateDegree = 0;
            clearInterval(swingProcess);
          }
        }, this.batSwingInterval);
      },
      /**
       * 「保存」ボタン押下処理
       */
      async onClickSaveButton() {
        if (this.isSavingResult) return;
        this.isSavingResult = true;
        const isLoggedIn = FirebaseAuthExtention.auth.isLoggedIn();
        const loginUserId = FirebaseAuthExtention.auth.getLoginUserId();
        const loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
        const loginUserIconImage =
          FirebaseAuthExtention.auth.getLoginUserIconImage();

        // 保存処理
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
      /**
       * 「保存せずにリトライ」ボタン押下処理
       */
      onClickRetryButton() {
        if (this.isSavingResult) return;
        this.shouldShowResult = false;
        this.executeBaseballGame();
      },
      /**
       * 結果表示画面で「保存せずに閉じる」ボタン押下処理
       */
      onClickFinishButton() {
        if (this.isSavingResult) return;
        this.shouldShowResult = false;
        this.initializeTopMenuData();
      },

      /**
       * トップメニュー画面のデータセット
       */
      async initializeTopMenuData() {
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
      /**
       * firestoreのデータを画面に表示するデータに変換
       * @param {*} firestoreDataList
       * @returns
       */
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
      /**
       * ゲストユーザの作成
       */
      async createGuestUser() {
        const { guestNumberWithPadding, randomString } =
          await FireStoreExtention.guestStore.createUserId();
        this.guestNumber = Number(guestNumberWithPadding);
        this.guestUserId = `${guestNumberWithPadding}${randomString}`;
      },
      /**
       * ゲーム開始
       */
      executeBaseballGame() {
        if (this.isGameOpened) return;
        // ゲーム開始前に初期化する
        this.clearBaseballGame();

        this.message = 'プレイボール！';
        this.isGameOpened = true;

        // 前の投球が完了するまで、次の投球を予約しない。
        const pitchNext = async () => {
          const startedAt = Date.now();
          // 1球投げる
          await this.throwBall();

          this.clearThrowingBall();

          if (this.outCount >= 3) {
            // ゲームセット後、一定時間はゲーム画面をそのまま表示する
            // 3アウト後にいきなり結果表示画面に移るとびっくりするため
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
      /**
       * 盤のセット
       */
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
      /**
       * 投球クリア処理
       */
      clearThrowingBall() {
        this.yBallPosition = 0;
        this.xBallPosition = 0;
        this.setBoardItems();
      },
      /**
       * ゲームのクリア処理
       */
      clearBaseballGame() {
        this.point = 0;
        this.outCount = 0;
        this.strikeCount = 0;
      },
      /**
       * 投球
       */
      async throwBall() {
        const boardList = window.document.getElementsByClassName('point-item');

        let yBallIncrement = getRandomNumber(
          this.minBallSpeed,
          this.maxBallSpeed,
        );
        let xBallIncrement = 0;
        let previousBallCenter = null;

        await new window.Promise((resolve) => {
          const ballMoveProcess = setInterval(() => {
            // ボールへの当たり判定
            // バットの始点座標、バットの終点座標
            const bat = window.document.getElementById('bat');
            const batPosition = bat.getBoundingClientRect();
            const batStartVec2 = new Vector2(batPosition.left, batPosition.top);
            const batEndVec2 = new Vector2(batPosition.right, batPosition.top);
            // ボールの中心座標
            const ball = window.document.getElementById('ball');
            const ballPosition = ball.getBoundingClientRect();
            const ballCenterVec2 = new Vector2(
              ballPosition.left + this.ballRadiusComputed,
              ballPosition.top + this.ballRadiusComputed,
            );
            // 判定処理
            // TODO:振り遅れの時どこまでバットに当たったといえるとするか（circleRaiusがマイナス）
            const isHitToBat = isHitCircleToLine(
              batStartVec2,
              batEndVec2,
              ballCenterVec2,
              this.ballRadiusComputed,
              -this.ballRadiusComputed * 3.5,
            );
            // 当たった時はボールを跳ね返す
            // 2度打ち防止のため、既にボールが跳ね返っているときはスルー
            if (isHitToBat && yBallIncrement >= 0) {
              yBallIncrement = -yBallIncrement;
              xBallIncrement = getRandomNumber(
                -this.maxXBallPosition,
                this.maxXBallPosition,
              );
              previousBallCenter = ballCenterVec2;
              return;
            }

            // iOS系の端末でボールの座標を検知できない時があるため、座標がセットされていなければ打ち直しとする
            // TODO:どういうわけかバットとの当たり判定前にこのチェックを行うと検知できないエラーが発生するため、バットとの当たり判定後にチェックしている
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

            // フェアゾーンに打ち返して盤に当たらなかったときはアウト
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

            // ボール移動
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
